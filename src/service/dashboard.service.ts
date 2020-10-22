import { ClickHouse } from 'clickhouse';
import { DatasetDataType } from '../entity/DatasetColumn';

import DatasetService from './dataset.service';

export default class DashboardService {
  private static singletonInstance: DashboardService;

  static get instance(): DashboardService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {}

  public async getAll(datasetId: number, columnId: number): Promise<any[]> {
    const dataset = await DatasetService.instance.getById(datasetId);

    const column = dataset.columns.find((col) => col.id === columnId);

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

    if (column.dataType === DatasetDataType.DATE) {
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

      return clickhouse.query(`SELECT ${columnName} as "name", count(*) as "value" FROM juno.${dataset.tableName} GROUP BY ${columnName} ORDER BY ${columnName} ASC`).toPromise();
    } else if (column.dataType === DatasetDataType.NUMBER) {
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

    return clickhouse.query(`SELECT ${column.name} as "name", count(*) as "value" FROM juno.${dataset.tableName} GROUP BY ${column.name} ORDER BY ${column.name} ASC`).toPromise();
  }
}
