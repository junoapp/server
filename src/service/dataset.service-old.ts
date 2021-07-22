import { getManager, EntityManager } from 'typeorm';
import * as fs from 'fs';
import { parse, unparse } from 'papaparse';
import { format, parse as dateParse } from 'date-fns';
import { DashboardInterface, DashboardUpdate, DatasetColumnExpandedType, DatasetColumnRole, DatasetColumnType, DatasetInterface, getExpandedType } from '@junoapp/common';

import { Dataset } from '../entity/Dataset';
import { DatasetColumn } from '../entity/DatasetColumn';
import logger from '../utils/logger';
import { convertName, getFilename } from '../utils/functions';
import ClickHouseService from './clickhouse.service';
import { Dashboard } from '../entity/Dashboard';
import UserService from './user.service';
import { ExpandedType } from 'compassql/build/src/query/expandedtype';

export default class DatasetService {
  private static singletonInstance: DatasetService;

  private clickHouseService: ClickHouseService = ClickHouseService.instance;

  static get instance(): DatasetService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {}

  private get entityManager(): EntityManager {
    return getManager();
  }

  public async getAll(): Promise<DatasetInterface[]> {
    return this.entityManager
      .createQueryBuilder(Dataset, 'dataset')
      .leftJoinAndSelect('dataset.addedBy', 'addedBy')
      .leftJoinAndSelect('dataset.userDatasets', 'userDatasets')
      .leftJoinAndSelect('dataset.columns', 'column')
      .orderBy('dataset.updatedDate', 'DESC')
      .getMany();
  }

  public async getById(id: number): Promise<DatasetInterface> {
    return this.entityManager
      .createQueryBuilder(Dataset, 'dataset')
      .leftJoinAndSelect('dataset.addedBy', 'addedBy')
      .leftJoinAndSelect('dataset.userDatasets', 'userDatasets')
      .leftJoinAndSelect('dataset.columns', 'columns')
      .where('dataset.id = :id', { id })
      .orderBy('columns.role', 'ASC')
      .addOrderBy('columns.name', 'ASC')
      .getOne();
  }

  public async upload(userId: number, file: Express.Multer.File): Promise<Dataset> {
    const [name] = getFilename(file.originalname);

    const user = await UserService.instance.getById(userId);

    let dataset = new Dataset();
    dataset.path = file.path;
    dataset.fieldname = file.fieldname;
    dataset.originalname = file.originalname;
    dataset.encoding = file.encoding;
    dataset.mimetype = file.mimetype;
    dataset.size = file.size;
    dataset.destination = file.destination;
    dataset.filename = file.filename;
    dataset.tableName = name;
    dataset.addedBy = user;

    this.insertClickhouse(dataset)
      .then(() => console.log('success'))
      .catch((error) => console.log('error', error));

    return await this.entityManager.save(Dataset, dataset);
  }

  public async getColumns(datasetId: number): Promise<DashboardInterface> {
    const dataset = await this.getById(datasetId);

    return dataset;
  }

  public async updateColumns(dashboardId: number, dashboardUpdate: DashboardUpdate): Promise<void> {
    await this.entityManager
      .transaction(async (entityManager) => {
        const ids = dashboardUpdate.colums.map((c) => c.id);

        const dashboard = await entityManager.findOne(Dashboard, dashboardId, { relations: ['datasets'] });

        dashboard.name = dashboardUpdate.name;
        dashboard.goalType = dashboardUpdate.goal;
        dashboard.goalPurpose = dashboardUpdate.purpose;

        await entityManager.save(Dashboard, dashboard);

        await entityManager
          .createQueryBuilder()
          .delete()
          .from(DatasetColumn)
          .where('id not in (:...ids)', { ids })
          .andWhere('dataset_id = :dataset', { dataset: dashboard.userDatasets[0].dataset.id })
          .execute();

        for (const columnRequest of dashboardUpdate.colums) {
          const column = await entityManager.findOne(DatasetColumn, columnRequest.id);

          column.role = columnRequest.role;
          column.index = columnRequest.index;

          await entityManager.save(DatasetColumn, column);
        }
      })
      .catch((error) => {
        console.log(error);
      });
  }

  public async delete(id: number): Promise<void> {
    const dataset = await this.getById(id);

    await this.entityManager.transaction(async (entityManager) => {
      await entityManager.delete(DatasetColumn, { dataset: dataset.id });
      await entityManager.delete(Dataset, dataset.id);

      try {
        fs.unlinkSync(dataset.path);
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
            const moneyFields = [];

            for (const key of data.meta.fields) {
              if (data.data[0][key] && data.data[0][key].includes && (data.data[0][key].includes('/') || data.data[0][key].includes('-') || data.data[0][key].includes(':'))) {
                dateFields.push(key);
              }

              if (data.data[0][key] && data.data[0][key].includes && data.data[0][key].includes('$')) {
                moneyFields.push(key);
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

                if (isNaN(+part1) || isNaN(+part2) || isNaN(+part3)) {
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

                if (typeof curr[key] === 'object') {
                  return prev;
                }

                if (moneyFields.includes(key) && curr[key] && curr[key].replace) {
                  curr[key] = Number(curr[key].replace(/[^0-9.-]+/g, ''));
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
                  type: 'string',
                });
              }
            }

            let newData: any[] = data.data;

            if (dates[0].length > 0) {
              const year = dates.findIndex((date) => date.every((d) => d.toString().length === 2 || d.toString().length === 4));
              const month = dates.findIndex((date) => date.every((d) => (d.toString().length === 1 || d.toString().length === 2) && d >= 0 && d <= 12));
              const day = [0, 1, 2].find((d) => d !== year && d !== month);

              const year4Digits = dates[year].every((d) => d.toString().length === 4);
              const month2Digits = dates[month].every((d) => d.toString().length === 2);
              const day2Digits = dates[day].every((d) => d.toString().length === 2);

              const dateFormat = [
                { order: year, format: year4Digits ? 'yyyy' : 'yy' },
                { order: month, format: month2Digits ? 'MM' : 'M' },
                { order: day, format: day2Digits ? 'dd' : 'd' },
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

                for (const moneyField of moneyFields) {
                  if (item[moneyField] && item[moneyField].replace) {
                    item[moneyField] = Number(item[moneyField].replace(/[^0-9.-]+/g, ''));
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
              let name = typeObj.name;

              if (typeObj.nullable) {
                type = `Nullable(${type})`;
              }

              if (columnArray.find((c) => c.name === name)) {
                name += Math.floor(Math.random() * 1000);
              }

              columnArray.push({
                name,
                type,
                typeName: typeObj.type === 'DateTime' ? 'date' : typeObj.type,
                column: `${name} ${type}`,
              });
            });

            const columns = columnArray.map((c) => c.column).join(',');

            const name = convertName(dataset.originalname);

            await this.clickHouseService.query(`DROP TABLE IF EXISTS ${name}`);

            const orderBy = primaryKeyDate || primaryKey;

            await this.clickHouseService.query(
              `CREATE TABLE ${name} (
                ${columns}
              )
              ENGINE = MergeTree()
              ORDER BY ${orderBy}`
            );

            const newFileData = fs.createReadStream(dataset.path);
            await this.clickHouseService.post(`INSERT INTO juno.${name} FORMAT CSVWithNames`, newFileData);

            const dataExpandedType = await this.clickHouseService.query(`select * from juno.${name}`);

            columnArray = getExpandedType(columnArray, dataExpandedType);

            columnArray.push({
              name: 'count',
              typeName: 'number',
              expandedType: DatasetColumnExpandedType.QUANTITATIVE,
              isCount: true,
            });

            for (const column of columnArray) {
              let role = DatasetColumnRole.DIMENSION;

              if (column.typeName === 'number') {
                role = DatasetColumnRole.MEASURE;
              }

              const distinctValues = await this.clickHouseService.query(
                column.isCount ? `SELECT COUNT(*) AS "value" FROM juno.${name}` : `SELECT COUNT(DISTINCT ${column.name}) AS "value" FROM juno.${name}`
              );

              if (distinctValues[0]['value'] === 0 || (column.expandedType === ExpandedType.QUANTITATIVE && distinctValues[0]['value'] === 1)) {
                continue;
              }

              const newColumn = new DatasetColumn();
              newColumn.name = column.name;
              newColumn.type = column.typeName;
              newColumn.expandedType = column.expandedType;
              newColumn.index = 0;
              newColumn.role = column.expandedType === DatasetColumnExpandedType.GEO ? DatasetColumnRole.DIMENSION : role;
              newColumn.dataset = dataset;
              newColumn.isPrimaryKey = false;
              newColumn.isForeignKey = false;
              newColumn.distinctValues = distinctValues[0]['value'];
              newColumn.isCount = !!column.isCount;

              await this.entityManager.save(DatasetColumn, newColumn);
            }

            resolve(true);
          } catch (error) {
            console.log(error);
            logger.error(error);
            reject(false);
          }
        },
      });
    });
  }
}
