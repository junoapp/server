import { getManager, EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as datalib from 'datalib';
import { ClickHouse } from 'clickhouse';
import got from 'got';
import { parse, unparse } from 'papaparse';
import { format, parse as dateParse } from 'date-fns';

import { Dataset } from '../entity/Dataset';
import { UploadResponse } from '../dto/upload-response';
import { DatasetColumn, DatasetColumnType } from '../entity/DatasetColumn';
import { DatasetColumnRequest } from '../dto/dataset-column-request';
import logger from '../utils/logger';
import { stringify } from 'querystring';
import { convertName } from '../utils/functions';

export default class DatasetService {
  private static singletonInstance: DatasetService;

  static get instance(): DatasetService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {}

  private get entityManager(): EntityManager {
    return getManager();
  }

  public async getAll(): Promise<Dataset[]> {
    return this.entityManager.find(Dataset, { relations: ['columns'], order: { updatedDate: 'DESC' } });
  }

  public async getById(id: number): Promise<Dataset> {
    return this.entityManager.findOne(Dataset, { where: { id }, relations: ['columns'], order: { updatedDate: 'DESC' } });
  }

  public async upload(file: Express.Multer.File): Promise<Dataset> {
    let dataset = new Dataset();
    dataset.path = file.path;
    dataset.fieldname = file.fieldname;
    dataset.originalname = file.originalname;
    dataset.encoding = file.encoding;
    dataset.mimetype = file.mimetype;
    dataset.size = file.size;
    dataset.destination = file.destination;
    dataset.filename = file.filename;

    this.insertClickhouse(dataset)
      .then(() => console.log('success'))
      .catch(() => console.log('error'));

    return await this.entityManager.save(Dataset, dataset);
  }

  public async getColumns(id: number): Promise<UploadResponse> {
    const dataset = await this.getById(id);

    const fileData = fs.readFileSync(dataset.path, 'utf8');
    const lines = fileData.split(/\r?\n/);

    const header = lines[0].replace(/\"/g, '').split(',');

    return {
      id: dataset.id,
      name: dataset.originalname,
      fields: header,
    };
  }

  public async updateColumns(datasetId: number, columns: DatasetColumnRequest[]): Promise<void> {
    await this.entityManager.transaction(async (entityManager) => {
      const dataset = await entityManager.findOne(Dataset, datasetId);
      await entityManager.delete(DatasetColumn, { dataset: dataset.id });

      for (const column of columns) {
        const newColumn = new DatasetColumn();
        newColumn.name = column.name;
        newColumn.type = column.type;
        newColumn.dataset = dataset;
        newColumn.index = column.index;

        await entityManager.save(DatasetColumn, newColumn);
      }
    });
  }

  public async delete(id: number): Promise<void> {
    const dataset = await this.getById(id);

    await this.entityManager.transaction(async (entityManager) => {
      await entityManager.delete(DatasetColumn, { dataset: id });
      await entityManager.delete(Dataset, id);

      try {
        fs.unlinkSync(dataset.path);
        if (dataset.nanocubeMapPath) {
          fs.unlinkSync(dataset.nanocubeMapPath);
        }
        if (dataset.nanocubeFilePath) {
          fs.unlinkSync(dataset.nanocubeFilePath);
        }
      } catch (error) {
        logger.error('Some file does not exist');
      }
    });
  }

  private async insertClickhouse(dataset: Dataset): Promise<boolean> {
    const fileData = fs.createReadStream(dataset.path);

    return new Promise((resolve, reject) => {
      parse(fileData, {
        header: true,
        dynamicTyping: true,
        transformHeader: (header) => {
          return convertName(header);
        },
        complete: async (data) => {
          try {
            const size = Math.floor(data.data.length / 10);

            const checkRows = [];

            let start = 0;
            for (let i = 0; i < 10; i++) {
              for (let j = 0; j < 10; j++) {
                if (data.data[start]) {
                  checkRows.push(data.data[start]);
                  start++;
                } else {
                  break;
                }
              }

              start += size;
            }

            const dateFields = [];
            for (const key of data.meta.fields) {
              if (data.data[0][key] && data.data[0][key].includes && (data.data[0][key].includes('/') || data.data[0][key].includes('-') || data.data[0][key].includes(':'))) {
                dateFields.push(key);
              }
            }

            const dates: number[][] = [[], [], []];
            const times: string[] = [];

            let timeFormat = '';
            let separator = '';

            const newDateFields = {};

            for (const dateField of dateFields) {
              for (const row of checkRows) {
                if (!row[dateField]) {
                  continue;
                }

                const [date, time] = row[dateField].split(' ');

                let part1: string;
                let part2: string;
                let part3: string;

                if (String(date).includes('/')) {
                  const [date1, date2, date3] = date.split('/');
                  separator = '/';

                  part1 = date1;
                  part2 = date2;
                  part3 = date3;
                } else if (String(date).includes('-')) {
                  const [date1, date2, date3] = date.split('-');
                  separator = '-';

                  part1 = date1;
                  part2 = date2;
                  part3 = date3;
                } else {
                  continue;
                }

                newDateFields[dateField] = true;

                dates[0].push(+part1);
                dates[1].push(+part2);
                dates[2].push(+part3);

                times.push(time);

                if (time) {
                  const timeSplit = String(time).split(':');
                  if (timeSplit.length === 1) {
                    timeFormat = 'HH';
                  } else if (timeSplit.length === 2) {
                    timeFormat = 'HH:mm';
                  } else if (timeSplit.length === 3) {
                    if (timeSplit[2].includes('+')) {
                      timeFormat = 'HH:mm:ssx';
                    } else {
                      timeFormat = 'HH:mm:ss';
                    }
                  }
                }
              }
            }

            let primaryKey: string;
            let primaryKeyCount: number = Number.MAX_VALUE;
            let primaryKeyDate: string;

            const types = [];
            for (const key of data.meta.fields) {
              const map = checkRows.reduce((prev, curr) => {
                if (!curr) {
                  return prev;
                }

                const type = typeof curr[key];

                if (type === 'object') {
                  return prev;
                }

                if (!prev[type]) {
                  prev[type] = {
                    count: 0,
                    distinct: {},
                  };
                }

                prev[type].count++;
                if (!prev[type].distinct[curr[key]]) {
                  prev[type].distinct[curr[key]] = 0;
                }

                prev[type].distinct[curr[key]]++;

                return prev;
              }, {});

              const keys = Object.keys(map).map((k) => ({
                type: k,
                count: map[k].count,
                distinct: Object.keys(map[k].distinct).length,
              }));

              if (Object.keys(newDateFields).includes(key)) {
                types.push({
                  nullable: keys[0].count < checkRows.length,
                  name: key,
                  type: 'DateTime',
                });

                if (!primaryKeyDate && keys[0].count === checkRows.length) {
                  primaryKeyDate = key;
                }
              } else if (keys.length > 0) {
                types.push({
                  nullable: keys[0].count < checkRows.length,
                  name: key,
                  type: keys[0].type,
                });

                if (keys[0].count === checkRows.length && keys[0].distinct < primaryKeyCount) {
                  primaryKey = key;
                  primaryKeyCount = keys[0].distinct;
                }
              } else {
                types.push({
                  nullable: true,
                  name: key,
                  type: 'String',
                });
              }
            }

            let newData: any[] = data.data;

            if (dates[0].length > 0) {
              const year = dates.findIndex((date) => date.every((d) => d.toString().length === 2 || d.toString().length === 4));
              const month = dates.findIndex((date) => date.every((d) => (d.toString().length === 1 || d.toString().length === 2) && d >= 0 && d <= 12));
              const day = [0, 1, 2].find((d) => d !== year && d !== month);

              const year4Digits = dates[year].every((d) => d.toString().length === 4);

              const dateFormat = [
                { order: year, format: year4Digits ? 'yyyy' : 'yy' },
                { order: month, format: 'MM' },
                { order: day, format: 'dd' },
              ];

              let dateFormatString = `${dateFormat
                .sort((a, b) => a.order - b.order)
                .map((d) => d.format)
                .join(separator)}`;

              if (timeFormat) {
                dateFormatString += ` ${timeFormat}`;
              }

              newData = [];

              for (let i = 0; i < data.data.length; i++) {
                const item = data.data[i];

                for (const dateField of Object.keys(newDateFields)) {
                  if (item[dateField] && item[dateField].length > 0) {
                    item[dateField] = format(dateParse(item[dateField], dateFormatString, new Date()), 'yyyy-MM-dd HH:mm:ss');
                  } else {
                    item[dateField] = null;
                  }
                }

                newData.push(item);
              }
            }

            const csv = unparse(newData, {
              newline: '\r\n',
            });

            fs.writeFileSync(dataset.path, csv, 'utf8');

            const fieldMap = {
              number: 'Float32',
              string: 'String',
              date: 'DateTime',
              integer: 'Int32',
            };

            let columnArray = [];
            types.forEach((typeObj) => {
              let type = fieldMap[typeObj.type] || typeObj.type;
              const name = typeObj.name;

              if (typeObj.nullable) {
                type = `Nullable(${type})`;
              }

              columnArray.push({
                name,
                type,
                typeName: typeObj.type === 'DateTime' ? 'date' : typeObj.type,
                column: `${name} ${type}`,
              });
            });

            const columns = columnArray.map((c) => c.column).join(',');
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

            const name = convertName(dataset.originalname);

            await clickhouse.query(`DROP TABLE IF EXISTS ${name}`).toPromise();

            // const partition = primaryKeyDate ? `toYYYYMM(${primaryKeyDate})` : primaryKey;
            const orderBy = primaryKeyDate || primaryKey;

            await clickhouse
              .query(
                `CREATE TABLE ${name} (
                ${columns}
              )
              ENGINE = MergeTree()
              ORDER BY ${orderBy}`
              )
              .toPromise();

            const newFileData = fs.createReadStream(dataset.path);
            await got(`http://localhost:8123/?query=INSERT INTO juno.${name} FORMAT CSVWithNames`, {
              method: 'POST',
              body: newFileData,
            });

            const selectColumns = columnArray.map((column) => `count(DISTINCT(${column.name})) AS "${column.name}"`).join(',');

            const countQuery = await clickhouse
              .query(
                `
                select 
                  count(*) as "total", 
                  ${selectColumns}
                from juno.${name}`
              )
              .toPromise();

            for (const column of columnArray) {
              let type = DatasetColumnType.DIMENSION;

              if (column.typeName === 'number' && countQuery[0]['total'] - countQuery[0][column.name] < countQuery[0]['total'] * 0.1) {
                type = DatasetColumnType.MEASURE;
              }

              const newColumn = new DatasetColumn();
              newColumn.name = column.name;
              newColumn.dataType = column.typeName;
              newColumn.index = 0;
              newColumn.type = type;
              newColumn.dataset = dataset;

              await this.entityManager.save(DatasetColumn, newColumn);
            }

            resolve(true);
          } catch (error) {
            logger.error(error);
            reject(false);
          }
        },
      });
    });
  }
}
