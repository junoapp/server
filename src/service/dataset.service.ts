import { getManager, EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as datalib from 'datalib';
import got from 'got';
import { parse, unparse } from 'papaparse';
import { format, parse as dateParse } from 'date-fns';
import { DatasetColumnExpandedType, DatasetColumnRole, DatasetColumnType } from '@junoapp/common';

import { Dataset } from '../entity/Dataset';
import { DatasetColumn } from '../entity/DatasetColumn';
import { DatasetColumnRequest } from '../dto/dataset-column-request';
import logger from '../utils/logger';
import { convertName, getFilename } from '../utils/functions';
import { convert, TimeUnit } from '../utils/timeunit';
import ClickHouseService from './clickhouse.service';

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

  public async getAll(): Promise<Dataset[]> {
    return this.entityManager.find(Dataset, { relations: ['columns'], order: { updatedDate: 'DESC' } });
  }

  public async getById(id: number): Promise<Dataset> {
    return this.entityManager
      .createQueryBuilder(Dataset, 'dataset')
      .leftJoinAndSelect('dataset.columns', 'columns')
      .where('dataset.id = :id', { id })
      .orderBy('columns.role', 'ASC')
      .addOrderBy('columns.name', 'ASC')
      .getOne();
  }

  public async upload(file: Express.Multer.File): Promise<Dataset> {
    const [name] = getFilename(file.originalname);

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

    this.insertClickhouse(dataset)
      .then(() => console.log('success'))
      .catch((error) => console.log('error', error));

    return await this.entityManager.save(Dataset, dataset);
  }

  public async getColumns(datasetId: number): Promise<Dataset> {
    const dataset = await this.getById(datasetId);

    return dataset;
  }

  public async updateColumns(datasetId: number, columns: DatasetColumnRequest[]): Promise<void> {
    await this.entityManager
      .transaction(async (entityManager) => {
        const ids = columns.map((c) => c.id);

        await entityManager.createQueryBuilder().delete().from(DatasetColumn).where('id not in (:...ids)', { ids }).andWhere('dataset_id = :dataset', { dataset: datasetId }).execute();

        for (const columnRequest of columns) {
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
      await entityManager.delete(DatasetColumn, { dataset: id });
      await entityManager.delete(Dataset, id);

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
            await got(`http://localhost:8123/?query=INSERT INTO juno.${name} FORMAT CSVWithNames`, {
              method: 'POST',
              body: newFileData,
            });

            columnArray = await this.getExpandedType(name, columnArray);

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

  private async getExpandedType(name: string, columnArray: any[]) {
    const data = await this.clickHouseService.query(`select * from juno.${name}`);

    let summaries = datalib.summary(data);
    let types = datalib.type.inferAll(data);

    const opt = {
      numberNominalLimit: 40,
      numberNominalProportion: 0.05,
      minPercentUniqueForKey: 0.8,
      minCardinalityForKey: 50,
      enum: {
        binProps: {
          maxbins: [5, 10, 20],
          extent: [undefined],
          base: [10],
          step: [undefined],
          steps: [undefined],
          minstep: [undefined],
          divide: [[5, 2]],
          binned: [false],
          anchor: [undefined],
          nice: [true],
        },
        timeUnit: [undefined, TimeUnit.YEAR, TimeUnit.MONTH, TimeUnit.MINUTES, TimeUnit.SECONDS],
      },
    };

    let fieldSchemas = summaries.map((fieldProfile, index) => {
      const name: string = fieldProfile.field;
      const columnIndex = columnArray.findIndex((c) => c.name === name);
      const column = columnArray[columnIndex];

      if (!column) {
        return null;
      }

      // In Table schema, 'date' doesn't include time so use 'datetime'
      const type: DatasetColumnType = column.typeName === 'date' ? DatasetColumnType.DATE : (column.typeName as any);

      let distinct: number = fieldProfile.distinct;
      let expandedType: DatasetColumnExpandedType;

      if (type === DatasetColumnType.NUMBER) {
        expandedType = DatasetColumnExpandedType.QUANTITATIVE;
      } else if (type === DatasetColumnType.INTEGER) {
        // use ordinal or nominal when cardinality of integer type is relatively low and the distinct values are less than an amount specified in options
        if (distinct < opt.numberNominalLimit && distinct / fieldProfile.count < opt.numberNominalProportion) {
          expandedType = DatasetColumnExpandedType.NOMINAL;
        } else {
          expandedType = DatasetColumnExpandedType.QUANTITATIVE;
        }
      } else if (type === DatasetColumnType.DATE) {
        expandedType = DatasetColumnExpandedType.TEMPORAL;
        // need to get correct min/max of date data because datalib's summary method does not
        // calculate this correctly for date types.
        fieldProfile.min = new Date(data[0][name]);
        fieldProfile.max = new Date(data[0][name]);
        for (const dataEntry of data) {
          const time = new Date(dataEntry[name]).getTime();
          if (time < (fieldProfile.min as Date).getTime()) {
            fieldProfile.min = new Date(time);
          }
          if (time > (fieldProfile.max as Date).getTime()) {
            fieldProfile.max = new Date(time);
          }
        }
      } else {
        expandedType = DatasetColumnExpandedType.NOMINAL;
      }

      if (expandedType === DatasetColumnExpandedType.NOMINAL && distinct / fieldProfile.count > opt.minPercentUniqueForKey && fieldProfile.count > opt.minCardinalityForKey) {
        expandedType = DatasetColumnExpandedType.KEY;
      }

      const GEO_TYPES = [
        'airport',
        ['area', 'code'],
        ['cbsa', 'msa'],
        'city',
        ['congressional', 'district'],
        'country',
        'region',
        'county',
        'latitude',
        'longitude',
        'nuts',
        'state',
        'province',
        'lat',
        'long',
        'lng',
        ['zip', 'code'],
        ['post', 'code'],
        ['postal', 'code'],
      ];

      for (const geoType of GEO_TYPES) {
        if (geoType instanceof Array) {
          let match = true;
          for (const part of geoType) {
            if (!name.toLowerCase().includes(part)) {
              match = false;
              break;
            }
          }

          if (match) {
            expandedType = DatasetColumnExpandedType.GEO;
          }
        } else {
          if (name.toLowerCase().includes(geoType)) {
            expandedType = DatasetColumnExpandedType.GEO;
          }
        }
      }

      let fieldSchema = {
        name,
        originalIndex: index,
        expandedType,
        type,
        stats: fieldProfile,
        timeStats: {} as { [timeUnit: string]: DLFieldProfile },
        binStats: {} as { [key: string]: DLFieldProfile },
      };

      columnArray[columnIndex].expandedType = expandedType;

      return fieldSchema;
    });

    // calculate preset bins for quantitative and temporal data
    for (let fieldSchema of fieldSchemas) {
      if (!fieldSchema) {
        continue;
      }

      if (fieldSchema.vlType === DatasetColumnExpandedType.QUANTITATIVE) {
        for (let maxbins of opt.enum.binProps.maxbins) {
          fieldSchema.binStats[maxbins] = this.binSummary(maxbins, fieldSchema.stats);
        }
      } else if (fieldSchema.vlType === DatasetColumnExpandedType.TEMPORAL) {
        for (let unit of opt.enum.timeUnit) {
          if (unit !== undefined) {
            fieldSchema.timeStats[unit] = this.timeSummary(unit, fieldSchema.stats);
          }
        }
      }
    }

    return columnArray;
  }

  /**
   * @return a summary of the binning scheme determined from the given max number of bins
   */
  private binSummary(maxbins: number, summary: DLFieldProfile): DLFieldProfile {
    const bin = datalib.bins({
      min: summary.min,
      max: summary.max,
      maxbins: maxbins,
    });

    // start with summary, pre-binning
    const result = datalib.extend({}, summary);
    result.unique = this.binUnique(bin, summary.unique);
    result.distinct = (bin.stop - bin.start) / bin.step;
    result.min = bin.start;
    result.max = bin.stop;

    return result;
  }

  /**
   * @return a new unique object based off of the old unique count and a binning scheme
   */
  private binUnique(bin: any, oldUnique: any) {
    const newUnique = {};
    for (let value in oldUnique) {
      let bucket: number;
      if (value === null) {
        bucket = null;
      } else if (isNaN(Number(value))) {
        bucket = NaN;
      } else {
        bucket = bin.value(Number(value)) as number;
      }
      newUnique[bucket] = (newUnique[bucket] || 0) + oldUnique[value];
    }
    return newUnique;
  }

  /** @return a modified version of the passed summary with unique and distinct set according to the timeunit.
   *  Maps 'null' (string) keys to the null value and invalid dates to 'Invalid Date' in the unique dictionary.
   */
  private timeSummary(timeunit: TimeUnit, summary: DLFieldProfile): DLFieldProfile {
    const result = datalib.extend({}, summary);

    let unique: { [value: string]: number } = {};
    datalib.keys(summary.unique).forEach(function (dateString) {
      // don't convert null value because the Date constructor will actually convert it to a date
      let date: Date = dateString === 'null' ? null : new Date(dateString);
      // at this point, `date` is either the null value, a valid Date object, or "Invalid Date" which is a Date
      let key: string;
      if (date === null) {
        key = null;
      } else if (isNaN(date.getTime())) {
        key = 'Invalid Date';
      } else {
        key = (timeunit === TimeUnit.DAY ? date.getDay() : convert(timeunit, date)).toString();
      }
      unique[key] = (unique[key] || 0) + summary.unique[dateString];
    });

    result.unique = unique;
    result.distinct = datalib.keys(unique).length;

    return result;
  }
}
