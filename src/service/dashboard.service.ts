// import { build } from 'compassql/build/src/schema';
// import { recommend } from 'compassql/build/src/recommend';
// import { mapLeaves } from 'compassql/build/src/result';
// import { SpecQuery } from 'compassql/build/src/query/spec';
// import { EncodingQuery, FieldQuery } from 'compassql/build/src/query/encoding';

import { schema, recommend, result, SpecQuery, EncodingQuery, FieldQuery } from 'compassql';

import * as datalib from 'datalib';
import { DatasetColumnExpandedType, DatasetColumnRole, DatasetColumnType, DatasetRecommendation, DatasetSpecEncodings } from '@junoapp/common';

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
    const dataset = await DatasetService.instance.getById(datasetId);

    const newData: { dimensions: DatasetColumn[]; measures: DatasetColumn[]; spec: DatasetSpecEncodings[] } = {
      dimensions: [],
      measures: [],
      spec: [],
    };

    for (const column of dataset.columns) {
      if (column.role === DatasetColumnRole.DIMENSION) {
        if (column.type === DatasetColumnType.STRING && column.expandedType !== DatasetColumnExpandedType.GEO) {
          if (column.distinctValues > 1 && column.distinctValues < 500) {
            newData.dimensions.push(column);
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

    newData.dimensions.sort((a, b) => {
      if (a.type === DatasetColumnType.DATE) {
        return -1;
      }

      if (b.type === DatasetColumnType.DATE) {
        return 1;
      }

      return a.distinctValues - b.distinctValues;
    });

    for (const dimension of newData.dimensions) {
      for (const measure of newData.measures) {
        const type = dimension.expandedType === DatasetColumnExpandedType.GEO ? DatasetColumnExpandedType.NOMINAL : dimension.expandedType;

        const encodings: DatasetSpecEncodings = [
          {
            // timeUnit: dimension.type === DatasetColumnType.DATE ? 'year' : null,
            channel: '?',
            field: dimension.name,
            type,
            bin: type === DatasetColumnExpandedType.QUANTITATIVE,
            column: dimension,
            trimValues: dimension.distinctValues > 30,
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

    const chartSpecs: DatasetRecommendation[] = [];

    for (const spec of newData.spec) {
      try {
        const data: SpecQuery = await this.getSpec(dataset, spec);

        chartSpecs.push({
          ...data,
          key: this.encodingFieldQuery(spec[0]).field.toString(),
          value: this.encodingFieldQuery(spec[1]).field.toString(),
          dimension: spec[0].column, // newData.spec[0],
          measure: spec[1].column, // newData.spec[1],
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

  public async getSpec(dataset: Dataset, spec: DatasetSpecEncodings): Promise<SpecQuery> {
    let queryResult = await this.getDataFromClickHouse(dataset, spec);

    if (this.encodingFieldQuery(spec[0]).bin) {
      queryResult = await this.binValues(spec, dataset, queryResult);
    }

    const compassSchema = schema.build(queryResult);

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

    const recommendationSpecs = result.mapLeaves(recommendations.result, (item) => item.toSpec());
    const recommendationSpec: SpecQuery = (recommendationSpecs.items[0] as any).items[0];

    return recommendationSpec;
  }

  private async binValues(spec: DatasetSpecEncodings, dataset: Dataset, queryResult: Object[]) {
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

  private async getDataFromClickHouse(dataset: Dataset, spec: DatasetSpecEncodings) {
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
        query = `SELECT ${dimension.field}, ${valueColumnName} AS "${measure.field}" FROM juno.${dataset.tableName} GROUP BY ${dimension.field} ORDER BY ${dimension.field} ASC`;
      }
    }

    console.log(query);

    return this.clickHouseService.query(query);
  }
}
