import { build } from 'compassql/build/src/schema';
import { recommend } from 'compassql/build/src/recommend';
import { mapLeaves, ResultTree } from 'compassql/build/src/result';
import { EncodingQuery, FieldQuery } from 'compassql/build/src/query/encoding';
import { FacetedUnitSpec, TopLevel } from 'vega-lite/build/src/spec';
import { InlineData } from 'vega-lite/build/src/data';
import * as fs from 'fs';
import * as path from 'path';
import { FieldDefBase } from 'vega-lite/build/src/channeldef';
import { Field } from 'vega';

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
  PreferenceType,
  UserDatasetInterface,
  UserInterface,
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

    let stackedDimensions: DatasetColumnInterface[] = [];

    for (const userColumn of dashboard.userDatasets[0].columns) {
      if (userColumn.removed) {
        continue;
      }

      if (userColumn.role === DatasetColumnRole.DIMENSION) {
        if (userColumn.column.type === DatasetColumnType.STRING && userColumn.column.expandedType !== DatasetColumnExpandedType.GEO) {
          if (userColumn.column.distinctValues > 1 && userColumn.column.distinctValues < 500) {
            newData.dimensions.push(userColumn.column);

            stackedDimensions.push(userColumn.column);
          }
        } else {
          if (userColumn.column.expandedType === DatasetColumnExpandedType.GEO) {
            if (userColumn.column.distinctValues > 1 && userColumn.column.distinctValues < 30) {
              newData.dimensions.push(userColumn.column);

              stackedDimensions.push(userColumn.column);
            }
          } else {
            newData.dimensions.push(userColumn.column);
          }
        }
      } else {
        newData.measures.push(userColumn.column);
      }
    }

    stackedDimensions = stackedDimensions.filter((a) => a.distinctValues < 10).sort((a, b) => a.distinctValues - b.distinctValues);

    newData.dimensions.sort((a, b) => {
      if (a.type === DatasetColumnType.DATE) {
        return -1;
      }

      if (b.type === DatasetColumnType.DATE) {
        return 1;
      }

      return a.distinctValues - b.distinctValues;
    });

    if (
      dashboard.userDatasets[0].owner.visLiteracy !== UserVisLiteracy.Low &&
      (!dashboard.userDatasets[0].owner.preferences || dashboard.userDatasets[0].owner.preferences.stacked) &&
      stackedDimensions.length >= 2
    ) {
      const mainDimension = stackedDimensions[0];

      stackedDimensions.splice(0, 1);

      for (const dimension of stackedDimensions) {
        for (const measure of newData.measures) {
          const type1 = mainDimension.expandedType === DatasetColumnExpandedType.GEO ? DatasetColumnExpandedType.NOMINAL : mainDimension.expandedType;
          const type2 = dimension.expandedType === DatasetColumnExpandedType.GEO ? DatasetColumnExpandedType.NOMINAL : dimension.expandedType;

          const encodings: DatasetSpecEncoding[] = [
            {
              channel: '?',
              field: mainDimension.name,
              type: type1,
              bin: false,
              column: mainDimension,
              trimValues: false,
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

          encodings.push({
            channel: 'color',
            field: dimension.name,
            type: type2,
            bin: false,
            column: dimension,
            trimValues: false,
          });

          newData.spec.push(encodings);
        }
      }
    }

    const binValues = dashboard.userDatasets[0].owner.preferences ? dashboard.userDatasets[0].owner.preferences.binValues : 50;
    const clampStrings = dashboard.userDatasets[0].owner.preferences ? dashboard.userDatasets[0].owner.preferences.clampStrings : 30;

    for (const dimension of newData.dimensions) {
      for (const measure of newData.measures) {
        if (newData.spec.find((s) => (s[0].column.name === dimension.name || (s[2] && s[2].column.name === dimension.name)) && s[1].column.name === measure.name)) {
          continue;
        }

        const type = dimension.expandedType === DatasetColumnExpandedType.GEO ? DatasetColumnExpandedType.NOMINAL : dimension.expandedType;

        const encodings: DatasetSpecEncoding[] = [
          {
            channel: '?',
            field: dimension.name,
            type,
            bin: type === DatasetColumnExpandedType.QUANTITATIVE && dimension.distinctValues > binValues,
            column: dimension,
            trimValues: dimension.type === DatasetColumnType.STRING && dimension.expandedType !== DatasetColumnExpandedType.GEO && dimension.distinctValues > clampStrings,
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

        if (dimension.type === DatasetColumnType.DATE) {
          this.encodingFieldQuery(encodings[0]).timeUnit = 'year';
        }

        newData.spec.push(encodings);
      }
    }

    let chartSpecs: DatasetRecommendation[] = [];

    const owner = dashboard.userDatasets[0].owner;

    for (const spec of newData.spec) {
      try {
        const data: TopLevel<FacetedUnitSpec> = await this.getSpec(dashboard.userDatasets[0].dataset, spec, owner, dashboard.userDatasets[0]);

        let mark = data.mark === 'point' ? 'bar' : data.mark;

        if (owner.preferences) {
          const type = owner.preferences.chartTypes.find((chartType) => {
            const fieldX = (data.encoding.x as FieldDefBase<Field>).field.toString();
            const fieldY = (data.encoding.y as FieldDefBase<Field>).field.toString();

            const columnX = dashboard.userDatasets[0].columns.find((c) => c.column.name === fieldX);
            const columnY = dashboard.userDatasets[0].columns.find((c) => c.column.name === fieldY);

            return columnX.column.type.toLocaleLowerCase() === chartType.typeX.toLowerCase() && columnY.column.type.toLocaleLowerCase() === chartType.typeY.toLowerCase();
          });

          if (type.chart === PreferenceType.Bar) {
            mark = 'bar';
          } else if (type.chart === PreferenceType.Line) {
            mark = 'line';
          }
        }

        chartSpecs.push({
          id: generateId(),
          ...data,
          key: this.encodingFieldQuery(spec[0]).field.toString(),
          value: this.encodingFieldQuery(spec[1]).field.toString(),
          dimension: spec[0].column,
          measure: spec[1].column,
          secondDimension: spec.length === 3 ? spec[2].column : null,
          trimValues: spec[0].trimValues,
          mark,
          userDimension: dashboard.userDatasets[0].columns.find((c) => c.column.id === spec[0].column.id),
          userMeasure: dashboard.userDatasets[0].columns.find((c) => c.column.id === spec[1].column.id),
          userSecondDimension: spec.length === 3 ? dashboard.userDatasets[0].columns.find((c) => c.column.id === spec[2].column.id) : null,
        });
      } catch (error) {
        console.log(error);
        continue;
      }
    }

    if (!dashboard.userDatasets[0].owner.preferences || dashboard.userDatasets[0].owner.preferences.multiline) {
      chartSpecs = this.aggroupLinesCharts(chartSpecs, dashboard);
    }

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
                values: await this.getDataFromClickHouse(dashboard.userDatasets[0].dataset, spec, dashboard.userDatasets[0].owner),
              },
            });
          }
        }
      }
    }
  }

  private async addHeadText(chartSpecs: DatasetRecommendation[], dashboard: DashboardInterface): Promise<void> {
    const measures = dashboard.userDatasets[0].columns.filter((d) => d.role === DatasetColumnRole.MEASURE && !d.removed && !d.column.isCount);

    if (measures.length <= 6) {
      for (const measure of measures) {
        let total = 0;

        if (measure.aggregate === DatasetSchemaAggregateFunction.None) {
          // continue;
          const dateDimension = dashboard.userDatasets[0].columns.find((c) => c.role === DatasetColumnRole.DIMENSION && c.column.type === DatasetColumnType.DATE);
          if (dateDimension) {
            const queryResult = await this.clickHouseService.query(
              `SELECT sum(${measure.column.name}) as "${measure.column.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName} GROUP BY ${dateDimension.column.name} ORDER BY ${dateDimension.column.name} DESC LIMIT 1`
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
          const queryResult = await this.clickHouseService.query(`SELECT min(${measure.column.name}) as "${measure.column.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName}`);

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
    const measures = dashboard.userDatasets[0].columns.filter((column) => column.role === DatasetColumnRole.MEASURE && !column.removed);

    let added = false;

    if (geoColumns.length > 1) {
      const hasLat = geoColumns.find((column) => column.name.toLowerCase() === 'latitude');
      const hasLng = geoColumns.find((column) => column.name.toLowerCase() === 'longitude');
      const dimensions = geoColumns
        .filter((column) => column.name.toLowerCase() !== 'latitude' && column.name.toLowerCase() !== 'longitude' && column.column.type !== DatasetColumnType.NUMBER)
        .sort((a, b) => b.column.distinctValues - a.column.distinctValues);

      if (dimensions.length > 0 && hasLat && hasLng) {
        const dimension = dimensions[0];
        const measure = measures[0];

        const data = await this.clickHouseService.query(`
            SELECT 
              ${dimension.column.name}, 
              avg(${hasLat.name}) as "latitude", 
              avg(${hasLng.name}) as "longitude", 
              ${measure.column.name === 'count' ? 'count(*)' : `sum(${measure.column.name})`} as "${measure.name}" 
            from juno.${dashboard.userDatasets[0].dataset.tableName} 
            group by 
              ${dimension.column.name}
            order by ${dimension.column.name} asc;
          `);

        chartSpecs.splice(0, 0, {
          id: generateId(),
          mark: 'geo-lat-lng',
          key: dimension.name,
          value: measure.name,
          dimension: dimension.column,
          measure: measure.column,
          trimValues: false,
          data: {
            values: data,
          },
          encoding: {},
          userDimension: dashboard.userDatasets[0].columns.find((column) => column.column.id === dimension.column.id),
          userMeasure: dashboard.userDatasets[0].columns.find((column) => column.column.id === measure.column.id),
        });

        added = true;
      }
    }

    if (geoColumns.length > 0 && !added) {
      const files = fs.readdirSync(path.join(__dirname, '../geojson/'));
      const matchMap: Record<string, Record<string, { total: number; matched: number }>> = {};
      let higherCount = 0;

      let dimensionColumn: string;
      let geoFile: string;

      for (const filePath of files) {
        const file = JSON.parse(fs.readFileSync(path.join(__dirname, '../geojson/' + filePath), 'utf8'));

        matchMap[filePath] = {};

        for (const dimension of geoColumns) {
          const dimensionValues = await this.clickHouseService.query(`SELECT DISTINCT ${dimension.column.name} FROM juno.${dashboard.userDatasets[0].dataset.tableName}`);

          matchMap[filePath][dimension.column.name] = {
            total: dimensionValues.length,
            matched: 0,
          };

          for (const value of dimensionValues) {
            if (file.features.some((feature) => feature.properties.name === value[dimension.column.name])) {
              matchMap[filePath][dimension.column.name].matched++;

              if (matchMap[filePath][dimension.column.name].matched > higherCount) {
                higherCount = matchMap[filePath][dimension.column.name].matched;
                geoFile = filePath;
                dimensionColumn = dimension.column.name;
              }
            }
          }
        }
      }

      if (dimensionColumn && geoFile) {
        const dimension = geoColumns.find((d) => d.column.name === dimensionColumn);
        for (const measure of measures) {
          const toRemove = chartSpecs.findIndex((spec) => spec.key === dimension.name && spec.value === measure.name);

          chartSpecs.splice(toRemove, 1);
          chartSpecs.splice(0, 0, {
            id: generateId(),
            mark: 'geoshape',
            key: dimension.column.name,
            value: measure.column.name,
            dimension: dimension.column,
            measure: measure.column,
            trimValues: false,
            data: {
              values: await this.clickHouseService.query(
                `SELECT ${dimension.column.name}, count(*) as "${measure.column.name}" FROM juno.${dashboard.userDatasets[0].dataset.tableName} GROUP BY ${dimension.column.name}`
              ),
            },
            encoding: {},
            geoFile,
            userDimension: dashboard.userDatasets[0].columns.find((column) => column.column.id === dimension.column.id),
            userMeasure: dashboard.userDatasets[0].columns.find((column) => column.column.id === measure.column.id),
          });
        }
      }
    }
  }

  private paginateChartRecommendation(chartSpecs: DatasetRecommendation[], dashboard: DashboardInterface): DashboardRecommendation {
    const measures: string[] = [...new Set(chartSpecs.map((c) => c.measure.name))];
    const chartsWithoutHeadtexts = chartSpecs.filter((chart) => chart.mark !== 'text');

    const dashboardRecommendation: DashboardRecommendation = {
      name: dashboard.name,
      pages: [],
    };

    const measuresSplitted: string[][] = [];
    for (const measure of measures) {
      measuresSplitted.push(measure.split('_'));
    }

    const measureMap: Record<string, { name: string; values: string[] }> = {};
    for (const measure of measuresSplitted) {
      for (const piece of measure) {
        // TODO: REMOVE STOP WORDS
        if (piece.length >= 3) {
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

    if ((!dashboard.goalType || (dashboard.goalType && dashboard.goalType !== DashboardGoal.Awareness)) && chartsWithoutHeadtexts.length > 10 && measures.length >= 3) {
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

      if (keys.length === 1) {
        const values = [...new Set(chartSpecs.filter((chart) => chart.mark === 'line' && !chart.multipleLines).map((chart) => chart.value))];

        if (values.length > 1) {
          // do {
          const valuesSpecs = chartSpecs.filter((chart) => chart.key === keys[0]);

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

              if (!isNaN(+v)) {
                newValues[key].values[valueSpec.value] = +v;
              }
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

          const axisMap: DatasetRecommendationMultipleLinesAxis = {};
          let countSkipped = 0;
          for (const key of Object.keys(maxMap)) {
            if (maxMap[key] === biggestValue) {
              axisMap[key] = 'left';
            } else {
              const percent = maxMap[key] / biggestValue;

              if (percent > 0.01) {
                axisMap[key] = percent > 0.2 ? 'left' : 'right';

                if (dashboard.userDatasets[0].owner.visLiteracy !== UserVisLiteracy.High || (dashboard.userDatasets[0].owner.preferences && !dashboard.userDatasets[0].owner.preferences.rightAxis)) {
                  axisMap[key] = 'left';
                }
              } else {
                countSkipped++;
              }
            }
          }

          // if (countSkipped < 10) {
          //   break;
          // }

          const addedSpecs = chartSpecs.filter((v) => v.mark === 'line' && axisMap[v.value] && !v.multipleLines);

          // if (addedSpecs.length === 0) {
          //   break;
          // }

          const addedIds = addedSpecs.map((spec) => spec.id);
          const removedSpecs = chartSpecs.filter((v) => !addedIds.includes(v.id));

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

                if (!isNaN(+v)) {
                  newValues[key].values[keySpec.key] = +v;
                }
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
                  axisMap[key] = percent > 0.2 ? 'left' : 'right';

                  if (dashboard.userDatasets[0].owner.visLiteracy !== UserVisLiteracy.High || (dashboard.userDatasets[0].owner.preferences && !dashboard.userDatasets[0].owner.preferences.rightAxis)) {
                    axisMap[key] = 'left';
                  }
                }
              }
            }

            const addedSpecs = chartSpecs.filter((v) => v.value === value && axisMap[v.key] && !v.multipleLines);
            const addedIds = addedSpecs.map((spec) => spec.id);
            const removedSpecs = chartSpecs.filter((v) => !addedIds.includes(v.id));

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

  private async getSpec(dataset: DatasetInterface, spec: DatasetSpecEncoding[], user: UserInterface, userDataset?: UserDatasetInterface): Promise<TopLevel<FacetedUnitSpec>> {
    let queryResult = await this.getDataFromClickHouse(dataset, spec, user, userDataset);

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

    const min = +minMax[0]['min'];

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

      max = +max.toFixed(2);

      let newMax: string = max.toString();

      if (max > 10000) {
        newMax = this.prefix(max);
      }

      const total = arr.reduce((prev, curr) => prev + +curr, 0);

      if (total > 0) {
        bins[`${start} - ${newMax}`] = total;
      }

      start = max;
    }

    return Object.keys(bins).map((d) => ({
      [dimension.field.toString()]: d,
      [measure.field.toString()]: bins[d],
    }));
  }

  private prefix(value: number, precision?: number): string {
    const units = ' K M G T P E Z Y'.split(' ');
    const base = 1000;

    if (typeof precision === 'undefined') {
      precision = 2;
    }

    if (value == 0 || !isFinite(value)) {
      return value.toFixed(precision) + units[0];
    }

    let power = Math.floor(Math.log(Math.abs(value)) / Math.log(base));
    power = Math.min(power, units.length - 1);

    return (value / Math.pow(base, power)).toFixed(precision) + units[power];
  }

  private async getDataFromClickHouse(dataset: DatasetInterface, spec: DatasetSpecEncoding[], user: UserInterface, userDataset?: UserDatasetInterface) {
    const dimension = this.encodingFieldQuery(spec[0]);
    const measure = this.encodingFieldQuery(spec[1]);

    let aggregation = 'sum';

    if (userDataset) {
      const userColumn = userDataset.columns.find((c) => c.name === measure.field.toString());

      if (userColumn) {
        aggregation = userColumn.aggregate.toLowerCase();

        const map = {
          min: 'min',
          mean: 'avg',
          sum: 'sum',
          max: 'max',
          median: 'median',
        };

        if (!map[aggregation]) {
          aggregation = 'sum';
        } else {
          aggregation = map[aggregation];
        }
      }
    }

    const column = spec[0].column;
    const valueColumnName = measure.field === 'count' ? `count(*)` : `${aggregation}(${measure.field})`;

    let query: string;

    const clampStrings = user.preferences ? user.preferences.clampStrings : 30;

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
        query = `SELECT ${dimension.field}, ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field} ORDER BY ${measure.field} DESC LIMIT ${clampStrings}`;
      } else {
        if (spec.length === 3) {
          const column = this.encodingFieldQuery(spec[2]);

          query = `SELECT ${dimension.field}, ${column.field}, ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field}, ${column.field} ORDER BY ${dimension.field} ASC`;
        } else {
          query = `SELECT ${dimension.field}, ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field} ORDER BY ${dimension.field} ASC`;
        }
      }
    }

    const response = await this.clickHouseService.postQuery(query);

    return JSON.parse(response.body)['data'];
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
