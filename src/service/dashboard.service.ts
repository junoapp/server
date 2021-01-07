import { build } from 'compassql/build/src/schema';
import { recommend } from 'compassql/build/src/recommend';
import { mapLeaves, ResultTree } from 'compassql/build/src/result';
import { EncodingQuery, FieldQuery } from 'compassql/build/src/query/encoding';
import { FacetedUnitSpec, TopLevel } from 'vega-lite/build/src/spec';

import * as datalib from 'datalib';
import {
  DatasetColumnExpandedType,
  DatasetColumnInterface,
  DatasetColumnRole,
  DatasetColumnType,
  DatasetInterface,
  DatasetRecommendation,
  DatasetSpecEncoding,
  DatasetSpecEncodings,
  UserVisLiteracy,
} from '@junoapp/common';

import { DatasetColumn } from '../entity/DatasetColumn';

import DatasetService from './dataset.service';
import ClickHouseService from './clickhouse.service';
import { Dataset } from '../entity/Dataset';
import { ExpandedType } from 'compassql/build/src/query/expandedtype';

export default class DashboardService {
  private static singletonInstance: DashboardService;

  private clickHouseService: ClickHouseService = ClickHouseService.instance;

  static get instance(): DashboardService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {}

  public async getChartRecommendation(datasetId: number): Promise<DatasetRecommendation[]> {
    const dashboard = await DatasetService.instance.getById(datasetId);

    const newData: { dimensions: DatasetColumnInterface[]; measures: DatasetColumnInterface[]; spec: DatasetSpecEncoding[][] } = {
      dimensions: [],
      measures: [],
      spec: [],
    };

    let newColumns: DatasetColumnInterface[] = [];

    for (const column of dashboard.datasets[0].columns) {
      if (column.role === DatasetColumnRole.DIMENSION) {
        if (column.type === DatasetColumnType.STRING && column.expandedType !== DatasetColumnExpandedType.GEO) {
          if (column.distinctValues > 1 && column.distinctValues < 500) {
            newData.dimensions.push(column);

            newColumns.push(column);
          }
        } else {
          if (column.expandedType === DatasetColumnExpandedType.GEO) {
            if (column.distinctValues > 1 && column.distinctValues < 30) {
              newData.dimensions.push(column);
            }
          } else {
            newData.dimensions.push(column);
          }
        }
      } else {
        newData.measures.push(column);
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

    console.log(newColumns);

    for (const dimension of newData.dimensions) {
      if (dashboard.user.visLiteracy !== UserVisLiteracy.low && newColumns.length >= 2 && dimension.id === newColumns[1].id) {
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

        if (dashboard.user.visLiteracy !== UserVisLiteracy.low && newColumns.length >= 2 && dimension.id === newColumns[0].id) {
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

    const chartSpecs: DatasetRecommendation[] = [];

    for (const spec of newData.spec) {
      try {
        const data: TopLevel<FacetedUnitSpec> = await this.getSpec(dashboard.datasets[0], spec);

        chartSpecs.push({
          ...data,
          key: this.encodingFieldQuery(spec[0]).field.toString(),
          value: this.encodingFieldQuery(spec[1]).field.toString(),
          dimension: spec[0].column,
          measure: spec[1].column,
          trimValues: spec[0].trimValues,
        });
      } catch (error) {
        console.log(error);
        continue;
      }
    }

    return chartSpecs;
  }

  private encodingFieldQuery(encoding: EncodingQuery): FieldQuery {
    return encoding as FieldQuery;
  }

  public async getSpec(dataset: DatasetInterface, spec: DatasetSpecEncoding[]): Promise<TopLevel<FacetedUnitSpec>> {
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

    const newData = {};
    const bins = datalib.bins({ min: minMax[0]['min'], max: minMax[0]['max'], maxbins: 10 });

    for (const queryItem of queryResult) {
      const binIndex = bins.value(queryItem[dimension.field.toString()]);

      if (!newData[binIndex]) {
        newData[binIndex] = 0;
      }

      newData[binIndex] += queryItem[measure.field.toString()];
    }

    return Object.keys(newData).map((d) => ({
      [dimension.field.toString()]: d,
      [measure.field.toString()]: newData[d],
    }));
  }

  private async getDataFromClickHouse(dataset: DatasetInterface, spec: DatasetSpecEncoding[]) {
    const dimension = this.encodingFieldQuery(spec[0]);
    const measure = this.encodingFieldQuery(spec[1]);

    const column = spec[0].column;
    const valueColumnName = measure.field === 'count' ? `count(*)` : `sum(${measure.field})`;

    let query: string;

    if (column.type === DatasetColumnType.DATE) {
      const dataInfo: Object[] = await this.clickHouseService.query(
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

      let format = '%Y';
      if (dataInfo[0]['year'] >= 5) {
        format = '%Y';
      } else if (dataInfo[0]['month'] >= 5) {
        format = '%Y/%m';
      } else if (dataInfo[0]['week'] >= 5) {
        format = '%Y/%m-%V';
      } else if (dataInfo[0]['day'] >= 5) {
        format = '%Y/%m/%d';
      }

      const columnName = `formatDateTime(${column.name}, '${format}')`;

      query = `SELECT ${columnName} AS "${dimension.field}", ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field} ORDER BY ${dimension.field} ASC`;
    } else {
      if (spec[0].trimValues) {
        query = `SELECT ${dimension.field}, ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field} ORDER BY ${measure.field} ASC LIMIT 30`;
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
}
