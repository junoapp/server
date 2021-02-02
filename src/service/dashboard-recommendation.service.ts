import { build } from 'compassql/build/src/schema';
import { recommend } from 'compassql/build/src/recommend';
import { mapLeaves, ResultTree } from 'compassql/build/src/result';
import { EncodingQuery, FieldQuery } from 'compassql/build/src/query/encoding';
import { FacetedUnitSpec, TopLevel } from 'vega-lite/build/src/spec';
import { InlineData } from 'vega-lite/build/src/data';

import * as datalib from 'datalib';
import {
  DashboardGoal,
  DashboardInterface,
  DashboardRecommendation,
  DatasetColumnExpandedType,
  DatasetColumnInterface,
  DatasetColumnRole,
  DatasetColumnType,
  DatasetInterface,
  DatasetRecommendation,
  DatasetRecommendationMultipleLines,
  DatasetRecommendationMultipleLinesAxis,
  DatasetRecommendationMultipleLinesData,
  DatasetSchemaAggregateFunction,
  DatasetSpecEncoding,
  DatasetSpecEncodings,
  generateId,
  JunoMark,
  UserVisLiteracy,
} from '@junoapp/common';

import { DatasetColumn } from '../entity/DatasetColumn';

import DatasetService from './dataset.service';
import ClickHouseService from './clickhouse.service';
import { Dataset } from '../entity/Dataset';
import { ExpandedType } from 'compassql/build/src/query/expandedtype';
import DashboardService from './dashboard.service';

export default class DashboardRecommendationService {
  private static singletonInstance: DashboardRecommendationService;

  private clickHouseService: ClickHouseService = ClickHouseService.instance;

  static get instance(): DashboardRecommendationService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {}

  public async getChartRecommendation(datasetId: number): Promise<DashboardRecommendation> {
    const dashboard = await DashboardService.instance.getById(datasetId);

    const newData: { dimensions: DatasetColumnInterface[]; measures: DatasetColumnInterface[]; spec: DatasetSpecEncoding[][] } = {
      dimensions: [],
      measures: [],
      spec: [],
    };

    let newColumns: DatasetColumnInterface[] = [];

    for (const userColumn of dashboard.userDatasets[0].columns) {
      if (userColumn.removed) {
        continue;
      }

      if (userColumn.role === DatasetColumnRole.DIMENSION) {
        if (userColumn.column.type === DatasetColumnType.STRING && userColumn.column.expandedType !== DatasetColumnExpandedType.GEO) {
          if (userColumn.column.distinctValues > 1 && userColumn.column.distinctValues < 500) {
            newData.dimensions.push(userColumn.column);

            newColumns.push(userColumn.column);
          }
        } else {
          if (userColumn.column.expandedType === DatasetColumnExpandedType.GEO) {
            if (userColumn.column.distinctValues > 1 && userColumn.column.distinctValues < 30) {
              newData.dimensions.push(userColumn.column);
            }
          } else {
            newData.dimensions.push(userColumn.column);
          }
        }
      } else {
        newData.measures.push(userColumn.column);
      }
    }

    newColumns = newColumns.filter((a) => a.distinctValues < 10).sort((a, b) => a.distinctValues - b.distinctValues);

    newData.dimensions.sort((a, b) => {
      if (a.type === DatasetColumnType.DATE) {
        return -1;
      }

      if (b.type === DatasetColumnType.DATE) {
        return 1;
      }

      return a.distinctValues - b.distinctValues;
    });

    console.log({ newColumns }, newData.dimensions);

    for (const dimension of newData.dimensions) {
      if (dashboard.userDatasets[0].owner.visLiteracy !== UserVisLiteracy.Low && newColumns.length >= 2 && dimension.id === newColumns[1].id) {
        continue;
      }

      for (const measure of newData.measures) {
        const type = dimension.expandedType === DatasetColumnExpandedType.GEO ? DatasetColumnExpandedType.NOMINAL : dimension.expandedType;

        const encodings: DatasetSpecEncoding[] = [
          {
            channel: '?',
            field: dimension.name,
            type,
            bin: type === DatasetColumnExpandedType.QUANTITATIVE && dimension.distinctValues > 50,
            column: dimension,
            trimValues: dimension.type === DatasetColumnType.STRING && dimension.expandedType !== DatasetColumnExpandedType.GEO && dimension.distinctValues > 30,
          },
          {
            channel: '?',
            field: measure.name,
            aggregate: 'sum',
            type: measure.expandedType as ExpandedType,
            scale: {},
            column: measure,
          },
        ];

        if (dashboard.userDatasets[0].owner.visLiteracy !== UserVisLiteracy.Low && newColumns.length >= 2 && dimension.id === newColumns[0].id) {
          encodings.push({
            channel: 'color',
            field: newColumns[1].name,
            type: newColumns[1].expandedType as ExpandedType,
            bin: false,
            column: newColumns[1],
            trimValues: false,
          });
        }

        if (dimension.type === DatasetColumnType.DATE) {
          this.encodingFieldQuery(encodings[0]).timeUnit = 'year';
        }

        newData.spec.push(encodings);
      }
    }

    let chartSpecs: DatasetRecommendation[] = [];

    for (const spec of newData.spec) {
      try {
        const data: TopLevel<FacetedUnitSpec> = await this.getSpec(dashboard.userDatasets[0].dataset, spec);

        chartSpecs.push({
          id: generateId(),
          ...data,
          key: this.encodingFieldQuery(spec[0]).field.toString(),
          value: this.encodingFieldQuery(spec[1]).field.toString(),
          dimension: spec[0].column,
          measure: spec[1].column,
          trimValues: spec[0].trimValues,
          mark: data.mark === 'point' ? 'bar' : data.mark,
        });
      } catch (error) {
        console.log(error);
        continue;
      }
    }

    chartSpecs = this.aggroupLinesCharts(chartSpecs, dashboard);

    await this.addHeatmaps(chartSpecs, dashboard, newData.spec);
    await this.addHeadText(chartSpecs, dashboard);
    await this.addMapchart(chartSpecs, dashboard);

    return this.paginateChartRecommendation(chartSpecs, dashboard);
  }

  private async addHeatmaps(chartSpecs: DatasetRecommendation[], dashboard: DashboardInterface, newDataSpec: DatasetSpecEncoding[][]): Promise<void> {
    for (let i = 0; i < chartSpecs.length; i++) {
      const chartSpec = chartSpecs[i];

      if (chartSpec.mark === 'line' && !chartSpec.multipleLines && chartSpec.dimension.type === DatasetColumnType.DATE && dashboard.userDatasets[0].owner.visLiteracy !== UserVisLiteracy.Low) {
        const spec = newDataSpec.find((s) => s[0].column.name === chartSpec.dimension.name && s[1].column.name === chartSpec.measure.name);

        if (spec) {
          const daysOfWeeek = await this.clickHouseService.query(
            `SELECT DISTINCT toDayOfWeek(${chartSpec.dimension.name}) as "${chartSpec.dimension.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName}`
          );

          if (+daysOfWeeek[0][chartSpec.dimension.name] > 1) {
            chartSpecs.splice(i + 1, 0, {
              ...chartSpec,
              id: generateId(),
              mark: 'heatmap',
              data: {
                values: await this.getDataFromClickHouse(dashboard.userDatasets[0].dataset, spec, true),
              },
            });
          }
        }
      }
    }
  }

  private async addHeadText(chartSpecs: DatasetRecommendation[], dashboard: DashboardInterface): Promise<void> {
    const measures = dashboard.userDatasets[0].columns.filter((d) => d.role === DatasetColumnRole.MEASURE && !d.removed && !d.column.isCount);

    if (measures.length < 6) {
      for (const measure of measures) {
        let total = 0;

        if (measure.aggregate === DatasetSchemaAggregateFunction.None) {
          const dateDimension = dashboard.userDatasets[0].columns.find((c) => c.role === DatasetColumnRole.DIMENSION && c.column.type === DatasetColumnType.DATE);

          if (dateDimension) {
            const queryResult = await this.clickHouseService.query(
              `SELECT ${measure.column.name} FROM juno.${dashboard.userDatasets[0].dataset.tableName} ORDER BY ${dateDimension.column.name} DESC LIMIT 1`
            );

            total = queryResult[0][measure.column.name];
          } else {
            continue;
          }
        } else if (measure.aggregate === DatasetSchemaAggregateFunction.Mean) {
          const queryResult = await this.clickHouseService.query(`SELECT avg(${measure.column.name}) as "${measure.column.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName}`);

          total = queryResult[0][measure.column.name];
        } else if (measure.aggregate === DatasetSchemaAggregateFunction.Sum) {
          const queryResult = await this.clickHouseService.query(`SELECT sum(${measure.column.name}) as "${measure.column.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName}`);

          total = queryResult[0][measure.column.name];
        } else if (measure.aggregate === DatasetSchemaAggregateFunction.Max) {
          const queryResult = await this.clickHouseService.query(`SELECT max(${measure.column.name}) as "${measure.column.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName}`);

          total = queryResult[0][measure.column.name];
        } else if (measure.aggregate === DatasetSchemaAggregateFunction.Min) {
          const queryResult = await this.clickHouseService.query(`SELECT max(${measure.column.name}) as "${measure.column.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName}`);

          total = queryResult[0][measure.column.name];
        } else if (measure.aggregate === DatasetSchemaAggregateFunction.Median) {
          const queryResult = await this.clickHouseService.query(`SELECT median(${measure.column.name}) as "${measure.column.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName}`);

          total = queryResult[0][measure.column.name];
        }

        chartSpecs.splice(0, 0, {
          id: generateId(),
          mark: 'text',
          key: measure.name,
          value: measure.name,
          dimension: measure.column,
          measure: measure.column,
          trimValues: false,
          data: {
            values: [+total],
          },
          encoding: {},
        });
      }
    }

    const onlyHaveCount = dashboard.userDatasets[0].columns.filter((d) => d.role === DatasetColumnRole.MEASURE && !d.removed);

    if (onlyHaveCount.length === 1 && onlyHaveCount[0].column.isCount) {
      const measure = onlyHaveCount[0];
      const queryResult = await this.clickHouseService.query(`SELECT count(*) as "count" FROM juno.${dashboard.userDatasets[0].dataset.tableName}`);

      chartSpecs.splice(0, 0, {
        id: generateId(),
        mark: 'text',
        key: measure.name,
        value: measure.name,
        dimension: measure.column,
        measure: measure.column,
        trimValues: false,
        data: {
          values: [+queryResult[0]['count']],
        },
        encoding: {},
      });
    }
  }

  private async addMapchart(chartSpecs: DatasetRecommendation[], dashboard: DashboardInterface): Promise<void> {
    const geoColumns = dashboard.userDatasets[0].columns.filter((column) => column.column.expandedType === DatasetColumnExpandedType.GEO);
    const measures = dashboard.userDatasets[0].columns.filter((column) => column.role === DatasetColumnRole.MEASURE);

    if (geoColumns.length > 0) {
      const dimension = geoColumns[0];

      for (const measure of measures) {
        const toRemove = chartSpecs.findIndex((spec) => spec.key === dimension.name && spec.value === measure.name);

        chartSpecs.splice(toRemove, 1);
        chartSpecs.splice(0, 0, {
          id: generateId(),
          mark: 'geoshape',
          key: dimension.name,
          value: measure.name,
          dimension: dimension.column,
          measure: measure.column,
          trimValues: false,
          data: {
            values: await this.clickHouseService.query(
              `SELECT ${dimension.column.name}, count(*) as "${measure.column.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName} GROUP BY ${dimension.column.name}`
            ),
          },
          encoding: {},
        });
      }
    }
  }

  private paginateChartRecommendation(chartSpecs: DatasetRecommendation[], dashboard: DashboardInterface): DashboardRecommendation {
    const measures: string[] = [...new Set(chartSpecs.map((c) => c.measure.name))];

    const dashboardRecommendation: DashboardRecommendation = {
      name: dashboard.name,
      pages: [],
    };

    console.log(chartSpecs.length, measures.length, measures);

    const measuresSplitted: string[][] = [];
    for (const measure of measures) {
      measuresSplitted.push(measure.split('_'));
    }

    const measureMap: Record<string, { name: string; values: string[] }> = {};
    for (const measure of measuresSplitted) {
      for (const piece of measure) {
        if (piece.length >= 4) {
          if (!measureMap[piece]) {
            measureMap[piece] = {
              name: piece,
              values: [],
            };
          }

          measureMap[piece].values.push(measure.join('_'));
        }
      }
    }

    const measureArray = Object.values(measureMap).sort((a, b) => a.values.length - b.values.length);

    console.log(measureArray);

    for (const measure1 of measureArray) {
      for (let i = measure1.values.length - 1; i >= 0; i--) {
        const value1 = measure1.values[i];

        for (const measure2 of measureArray) {
          if (measure1.name !== measure2.name) {
            if (measure2.values.includes(value1)) {
              measure1.values.splice(i, 1);
              break;
            }
          }
        }
      }
    }

    let t = 0;
    for (let i = measureArray.length - 1; i >= 0; i--) {
      if (measureArray[i].values.length === 0) {
        measureArray.splice(i, 1);
      } else {
        t += measureArray[i].values.length;
      }
    }

    measureArray.reverse();

    console.log(measureArray, measureArray.length, t);

    if ((!dashboard.goalType || (dashboard.goalType && dashboard.goalType !== DashboardGoal.Awareness)) && chartSpecs.length > 10 && measures.length >= 3) {
      for (const measurePage of measureArray) {
        let charts = [];

        for (const measure of measurePage.values) {
          charts.push(...chartSpecs.filter((chart) => chart.measure.name === measure));
        }

        dashboardRecommendation.pages.push({
          name: measurePage.values.length === 1 ? measurePage.values[0] : measurePage.name,
          charts,
        });
      }
    } else {
      dashboardRecommendation.pages.push({
        name: dashboard.name,
        charts: chartSpecs,
      });
    }

    return dashboardRecommendation;
  }

  private aggroupLinesCharts(chartSpecs: DatasetRecommendation[], dashboard: DashboardInterface): DatasetRecommendation[] {
    const lines = chartSpecs.filter((chart) => chart.mark === 'line');

    if (lines.length > 1 && dashboard.userDatasets[0].owner.visLiteracy !== UserVisLiteracy.Low) {
      const keys = [...new Set(lines.map((line) => line.key))];

      console.log({ keys });

      if (keys.length === 1) {
        const values = [...new Set(chartSpecs.filter((chart) => chart.mark === 'line' && !chart.multipleLines).map((chart) => chart.value))];

        console.log({ values });

        if (values.length > 1) {
          // do {
          const valuesSpecs = chartSpecs.filter((chart) => chart.key === keys[0]);

          // console.log({ valuesSpecs });

          let newValues: Record<string, DatasetRecommendationMultipleLinesData> = {};

          for (const valueSpec of valuesSpecs) {
            for (const value of (valueSpec.data as InlineData).values as Array<any>) {
              const key = value[valueSpec.key];

              if (!newValues[key]) {
                newValues[key] = {
                  name: key,
                  values: {},
                };
              }

              const v = value[valueSpec.value];

              newValues[key].values[valueSpec.value] = isNaN(+v) ? undefined : +v;
            }
          }

          const newValuesArray = Object.values(newValues);
          const valuesMap: Record<string, number[]> = {};

          for (const newValue of newValuesArray) {
            for (const key of Object.keys(newValue.values)) {
              if (!valuesMap[key]) {
                valuesMap[key] = [];
              }

              valuesMap[key].push(newValue.values[key]);
            }
          }

          let biggestValue = Number.MIN_SAFE_INTEGER;
          // let secondBiggestValue = Number.MIN_SAFE_INTEGER;

          const maxMap: Record<string, number> = {};
          for (const key of Object.keys(valuesMap)) {
            const max = Math.max(...valuesMap[key]);

            maxMap[key] = max;

            if (max > biggestValue) {
              biggestValue = max;
            }
          }

          console.log({ maxMap });

          const axisMap: DatasetRecommendationMultipleLinesAxis = {};
          let countSkipped = 0;
          for (const key of Object.keys(maxMap)) {
            if (maxMap[key] === biggestValue) {
              axisMap[key] = 'left';
            } else {
              const percent = maxMap[key] / biggestValue;

              // console.log(key, percent);

              if (percent > 0.01) {
                axisMap[key] = percent > 0.2 || dashboard.userDatasets[0].owner.visLiteracy !== UserVisLiteracy.High ? 'left' : 'right';
              } else {
                countSkipped++;
              }
            }
          }

          // if (countSkipped < 10) {
          //   break;
          // }

          console.log({ axisMap });

          const addedSpecs = chartSpecs.filter((v) => v.mark === 'line' && axisMap[v.value] && !v.multipleLines);

          // if (addedSpecs.length === 0) {
          //   break;
          // }

          const addedIds = addedSpecs.map((spec) => spec.id);
          const removedSpecs = chartSpecs.filter((v) => !addedIds.includes(v.id));

          // console.log({ addedSpecs, removedSpecs });

          const multipleLines: DatasetRecommendationMultipleLines = {
            data: newValuesArray,
            specs: JSON.parse(JSON.stringify(addedSpecs)),
            axis: axisMap,
          };

          const newSpecs = [addedSpecs[0], ...removedSpecs];

          newSpecs[0].multipleLines = multipleLines;

          chartSpecs = newSpecs;
          // } while (true);
        }
      } else {
        const values = [...new Set(chartSpecs.filter((chart) => chart.mark === 'line').map((chart) => chart.value))];

        console.log({ values });

        if (values.length > 0) {
          for (const value of values) {
            const keysSpecs = chartSpecs.filter((chart) => chart.mark === 'line' && chart.value === value);

            let newValues: Record<string, DatasetRecommendationMultipleLinesData> = {};

            for (const keySpec of keysSpecs) {
              for (const value of (keySpec.data as InlineData).values as Array<any>) {
                const key = value[keySpec.key];

                if (!newValues[key]) {
                  newValues[key] = {
                    name: key,
                    values: {},
                  };
                }

                const v = value[keySpec.value];

                newValues[key].values[keySpec.key] = isNaN(+v) ? undefined : +v;
              }
            }

            const newValuesArray = Object.values(newValues);
            const valuesMap: Record<string, number[]> = {};

            for (const newValue of newValuesArray) {
              for (const key of Object.keys(newValue.values)) {
                if (!valuesMap[key]) {
                  valuesMap[key] = [];
                }

                valuesMap[key].push(newValue.values[key]);
              }
            }

            let biggestValue = Number.MIN_SAFE_INTEGER;
            const maxMap: Record<string, number> = {};
            for (const key of Object.keys(valuesMap)) {
              const max = Math.max(...valuesMap[key]);

              maxMap[key] = max;

              if (max > biggestValue) {
                biggestValue = max;
              }
            }

            const axisMap: DatasetRecommendationMultipleLinesAxis = {};
            for (const key of Object.keys(maxMap)) {
              if (maxMap[key] === biggestValue) {
                axisMap[key] = 'left';
              } else {
                const percent = maxMap[key] / biggestValue;

                if (percent > 0.01) {
                  axisMap[key] = percent > 0.2 || dashboard.userDatasets[0].owner.visLiteracy !== UserVisLiteracy.High ? 'left' : 'right';
                }
              }
            }

            console.log(axisMap);

            const addedSpecs = chartSpecs.filter((v) => v.value === value && axisMap[v.key] && !v.multipleLines);
            const addedIds = addedSpecs.map((spec) => spec.id);
            const removedSpecs = chartSpecs.filter((v) => !addedIds.includes(v.id));

            console.log({ addedSpecs, removedSpecs });

            const multipleLines: DatasetRecommendationMultipleLines = {
              data: newValuesArray,
              specs: JSON.parse(JSON.stringify(addedSpecs)),
              axis: axisMap,
            };

            const newSpecs = [addedSpecs[0], ...removedSpecs];

            newSpecs[0].multipleLines = multipleLines;

            chartSpecs = newSpecs;
          }
        }
      }
    }
    return chartSpecs;
  }

  private encodingFieldQuery(encoding: EncodingQuery): FieldQuery {
    return encoding as FieldQuery;
  }

  private async getSpec(dataset: DatasetInterface, spec: DatasetSpecEncoding[]): Promise<TopLevel<FacetedUnitSpec>> {
    let queryResult = await this.getDataFromClickHouse(dataset, spec);

    if (this.encodingFieldQuery(spec[0]).bin) {
      queryResult = await this.binValues(spec, dataset, queryResult);
    }

    const compassSchema = build(queryResult);

    const recommendations = recommend(
      {
        spec: {
          data: { values: queryResult },
          mark: '?',
          encodings: spec,
        },
        orderBy: ['aggregationQuality', 'effectiveness'],
        chooseBy: ['aggregationQuality', 'effectiveness'],
        groupBy: 'encoding',
      },
      compassSchema
    );

    const recommendationSpecs = mapLeaves(recommendations.result, (item) => item.toSpec());
    const recommnedationSpecItems = recommendationSpecs.items[0] as ResultTree<TopLevel<FacetedUnitSpec>>;
    const recommendationSpec = recommnedationSpecItems.items[0] as TopLevel<FacetedUnitSpec>;

    return recommendationSpec;
  }

  private async binValues(spec: DatasetSpecEncoding[], dataset: DatasetInterface, queryResult: Object[]) {
    const dimension = this.encodingFieldQuery(spec[0]);
    const measure = this.encodingFieldQuery(spec[1]);

    const minMax = await this.clickHouseService.query(`SELECT min(${dimension.field}) as "min", max(${dimension.field}) as "max" FROM juno.${dataset.tableName}`);
    const min = minMax[0]['min'];

    const numberOfBins = 10;
    const length = queryResult.length;
    const delta = Math.ceil(length / numberOfBins);

    const bins: Record<number, number> = {};

    let start = min;

    for (let i = 0; i < numberOfBins; i++) {
      let arr = [];
      let max = 0;
      for (let j = i * delta; j < (i + 1) * delta; j++) {
        if (j >= length) {
          break;
        }

        arr = [...arr, queryResult[j][measure.field.toString()]];

        if (queryResult[j][dimension.field.toString()] > max) {
          max = queryResult[j][dimension.field.toString()];
        }
      }

      bins[`${start}-${max}`] = arr.reduce((prev, curr) => prev + curr, 0);

      start = max;
    }

    return Object.keys(bins).map((d) => ({
      [dimension.field.toString()]: d,
      [measure.field.toString()]: bins[d],
    }));
  }

  private async getDataFromClickHouse(dataset: DatasetInterface, spec: DatasetSpecEncoding[], byDay = false) {
    const dimension = this.encodingFieldQuery(spec[0]);
    const measure = this.encodingFieldQuery(spec[1]);

    const column = spec[0].column;
    const valueColumnName = measure.field === 'count' ? `count(*)` : `sum(${measure.field})`;

    let query: string;

    if (column.type === DatasetColumnType.DATE) {
      let format = '%Y';

      // if (byDay) {
      format = '%Y/%m/%d';
      // } else {
      //   const dateInfo: Object[] = await this.getDateInfo(column, dataset);

      //   if (dateInfo[0]['year'] >= 12) {
      //     format = '%Y';
      //   } else if (dateInfo[0]['month'] >= 12) {
      //     format = '%Y/%m';
      //   } else if (dateInfo[0]['week'] >= 12) {
      //     format = '%Y/%m-%V';
      //   } else if (dateInfo[0]['day'] >= 12) {
      //     format = '%Y/%m/%d';
      //   }
      // }

      const columnName = `formatDateTime(${column.name}, '${format}')`;

      query = `SELECT ${columnName} AS "${dimension.field}", ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field} ORDER BY ${dimension.field} ASC`;
    } else {
      if (spec[0].trimValues) {
        query = `SELECT ${dimension.field}, ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field} ORDER BY ${measure.field} DESC LIMIT 30`;
      } else {
        if (spec.length === 3) {
          const column = this.encodingFieldQuery(spec[2]);

          query = `SELECT ${dimension.field}, ${column.field}, ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field}, ${column.field} ORDER BY ${dimension.field} ASC`;
        } else {
          query = `SELECT ${dimension.field}, ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field} ORDER BY ${dimension.field} ASC`;
        }
      }
    }

    console.log(query);

    return this.clickHouseService.query(query);
  }

  private getDateInfo(column: DatasetColumnInterface, dataset: DatasetInterface): Promise<Object[]> {
    return this.clickHouseService.query(
      `
          SELECT
            min(${column.name}) AS "min",
            max(${column.name}) AS "max",
            datediff('year', min(${column.name}), max(${column.name})) AS "year",
            datediff('quarter', min(${column.name}), max(${column.name})) AS "quarter",
            datediff('month', min(${column.name}), max(${column.name})) AS "month",
            datediff('week', min(${column.name}), max(${column.name})) AS "week",
            datediff('day', min(${column.name}), max(${column.name})) AS "day"
          FROM juno.${dataset.tableName}
          `
    );
  }
}
