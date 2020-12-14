import { ClickHouse } from 'clickhouse';
import { recommend, schema, result } from 'compassql';
import * as datalib from 'datalib';

import { DatasetColumn, DatasetColumnExpandedType, DatasetColumnRole, DatasetColumnType } from '../entity/DatasetColumn';

import DatasetService from './dataset.service';

export default class DashboardService {
  private static singletonInstance: DashboardService;

  static get instance(): DashboardService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {}

  public async getChartRecommendatioo(datasetId: number): Promise<any[]> {
    const dataset = await DatasetService.instance.getById(datasetId);

    const newData: { dimensions: DatasetColumn[]; measures: DatasetColumn[]; spec: any[] } = {
      dimensions: [],
      measures: [],
      spec: [],
    };

    for (const column of dataset.columns) {
      if (column.role === DatasetColumnRole.DIMENSION) {
        if (column.type === DatasetColumnType.STRING) {
          if (column.distinctValues > 1 && column.distinctValues < 30) {
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

        const encodings: any[] = [
          {
            channel: '?',
            field: dimension.name,
            type,
            bin: type === DatasetColumnExpandedType.QUANTITATIVE,
          },
          {
            channel: '?',
            field: measure.name,
            aggregate: 'sum',
            type: measure.expandedType,
            scale: {},
          },
        ];

        if (dimension.type === DatasetColumnType.DATE) {
          encodings[0].timeUnit = 'year';
        }

        newData.spec.push(encodings);
      }
    }

    console.log(newData.spec);

    const chartSpecs = [];

    for (const spec of newData.spec) {
      try {
        const data: any = await this.getSpec(dataset.id, spec);

        chartSpecs.push({
          ...data.items[0],
          key: spec[0].field,
          value: spec[1].field,
        });
      } catch (error) {
        console.log(error);
        continue;
      }
    }

    return chartSpecs;
  }

  public async getSpec(datasetId: number, spec: any[]): Promise<any[]> {
    const dataset = await DatasetService.instance.getById(datasetId);

    // const column = dataset.columns.find((col) => col.name === name);

    const clickhouse = new ClickHouse({
      url: 'http://localhost',
      port: 8123,
      basicAuth: {
        username: 'default',
        password: '',
      },
      isUseGzip: true,
      format: 'csv',
      config: {
        session_id: 'session_id if neeed',
        session_timeout: 60,
        output_format_json_quote_64bit_integers: 0,
        enable_http_compression: 0,
        database: 'juno',
        max_partitions_per_insert_block: 1000,
      },
    });

    const valueColumn = spec[1].field === 'count' ? `count(*)` : `sum(${spec[1].field})`;

    const q = `SELECT ${spec[0].field}, ${valueColumn} as "${spec[1].field}" FROM juno.${dataset.tableName} group by ${spec[0].field} order by ${spec[0].field} asc`;

    let d = await clickhouse.query(q).toPromise();

    console.log(d);

    if (spec[0].bin) {
      const minMax = await clickhouse.query(`SELECT min(${spec[0].field}) as "min", max(${spec[0].field}) as "max" FROM juno.${dataset.tableName}`).toPromise();

      const newData = {};
      const bin = datalib.bins({ min: minMax[0]['min'], max: minMax[0]['max'], maxbins: 10 });

      for (let i = 0; i < d.length; i++) {
        const dd = d[i];

        const b = bin.value(dd[spec[0].field]);

        if (!newData[b]) {
          newData[b] = 0;
        }

        newData[b] += dd[spec[1].field];
      }

      console.log(newData);

      d = Object.keys(newData).map((d) => ({
        [spec[0].field]: d,
        [spec[1].field]: newData[d],
      }));
    }

    const sch = schema.build(d);

    const rs = recommend(
      {
        spec: {
          data: { values: d },
          mark: '?',
          encodings: spec,
        },
        orderBy: ['aggregationQuality', 'effectiveness'],
        chooseBy: ['aggregationQuality', 'effectiveness'],
        groupBy: 'encoding',
      },
      sch
    );

    var vlTree = result.mapLeaves(rs.result, function (item) {
      return item.toSpec();
    });

    console.log(vlTree.items);

    return vlTree.items[0];
  }

  public async getAll(datasetId: number, name: string, value?: string): Promise<any[]> {
    const dataset = await DatasetService.instance.getById(datasetId);

    const column = dataset.columns.find((col) => col.name === name);

    const clickhouse = new ClickHouse({
      url: 'http://localhost',
      port: 8123,
      basicAuth: {
        username: 'default',
        password: '',
      },
      isUseGzip: true,
      format: 'csv',
      config: {
        session_id: 'session_id if neeed',
        session_timeout: 60,
        output_format_json_quote_64bit_integers: 0,
        enable_http_compression: 0,
        database: 'juno',
        max_partitions_per_insert_block: 1000,
      },
    });

    const valueName = value === 'count(*)' ? 'count' : value;

    const q = value
      ? `SELECT ${name}, ${value} as "${valueName}" FROM juno.${dataset.tableName} ${value === 'count(*)' ? `GROUP BY ${name}` : ''} LIMIT 1000`
      : `SELECT ${name} FROM juno.${dataset.tableName} LIMIT 1000`;

    const d = await clickhouse.query(q).toPromise();

    const sch = schema.build(d);

    const encodings: any[] = [
      {
        channel: '?',
        aggregate: '?',
        timeUnit: '?',
        field: name,
        type: column.expandedType,
      },
    ];

    if (value) {
      const columnValue = dataset.columns.find((col) => col.name === value);

      encodings.push({
        channel: '?',
        aggregate: valueName === 'count' ? 'count' : '?',
        timeUnit: '?',
        field: valueName === 'count' ? '*' : valueName,
        type: columnValue ? columnValue.expandedType : 'quantitative',
      });
    }

    console.log(encodings);

    const rs = recommend(
      {
        spec: {
          data: { values: d },
          mark: '?',
          encodings,
        },
        orderBy: ['aggregationQuality', 'effectiveness'],
        chooseBy: ['aggregationQuality', 'effectiveness'],
        groupBy: 'encoding',
      },
      sch
    );

    var vlTree = result.mapLeaves(rs.result, function (item) {
      return item.toSpec();
    });

    console.log(vlTree.items);

    return vlTree.items[0];

    if (column.type === DatasetColumnType.DATE) {
      type DateInfo = { min: Date; max: Date; year: number; quarter: number; month: number; week: number; day: number };

      const dataInfo: Array<Object> = await clickhouse
        .query(
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
        )
        .toPromise();

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

      const query = `SELECT ${columnName} as "name", ${value} as "value" FROM juno.${dataset.tableName} GROUP BY ${columnName} ORDER BY ${columnName} ASC`;

      console.log(query);

      return clickhouse.query(query).toPromise();
    } else if (column.type === DatasetColumnType.NUMBER) {
      // const dataInfo: Array<Object> = await clickhouse
      //   .query(
      //     `
      //     SELECT
      //       min(${column.name}) AS "min",
      //       max(${column.name}) AS "max"
      //     FROM juno.${dataset.tableName}
      //   `
      //   )
      //   .toPromise();
      // let min = dataInfo[0]['min'];
      // const offset = (dataInfo[0]['max'] - min) / 10;
      // if (offset > 1) {
      //   const conditionals = [];
      //   for (let i = 0; i < 9; i++) {
      //     conditionals.push(`${column.name} < ${min + offset}, '${min}-${min + offset}'`);
      //     min += offset;
      //   }
      //   console.log(conditionals);
      //   return clickhouse
      //     .query(
      //       `
      //       SELECT
      //         multiIf (
      //           ${conditionals.join(',')},
      //           'Others'
      //         ) AS name,
      //         count(*) as "value"
      //       FROM juno.${dataset.tableName}
      //       GROUP BY name
      //       ORDER BY name
      //       `
      //     )
      //     .toPromise();
      // }
    }

    const query = `SELECT ${column.name} as "name", ${value} as "value" FROM juno.${dataset.tableName} GROUP BY ${column.name} ORDER BY ${column.name} ASC`;

    console.log(query);

    return clickhouse.query(query).toPromise();
  }
}
