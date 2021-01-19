import { getManager, EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as datalib from 'datalib';
import { parse, unparse } from 'papaparse';
import { format, parse as dateParse } from 'date-fns';
import { DashboardInterface, DashboardUpdate, DatasetColumnExpandedType, DatasetColumnRole, DatasetColumnType, DatasetInterface } from '@junoapp/common';

import { Dataset } from '../entity/Dataset';
import { DatasetColumn } from '../entity/DatasetColumn';
import { DatasetColumnRequest } from '../dto/dataset-column-request';
import logger from '../utils/logger';
import { convertName, getFilename } from '../utils/functions';
import { convert, TimeUnit } from '../utils/timeunit';
import ClickHouseService from './clickhouse.service';
import { Dashboard } from '../entity/Dashboard';
import { User } from '../entity/User';
import UserService from './user.service';
import { UserDataset } from '../entity/UserDataset';
import DatasetService from './dataset.service';
import { UserDatasetColumn } from '../entity/UserDatasetColumn';

export default class DashboardService {
  private static singletonInstance: DashboardService;

  private clickHouseService: ClickHouseService = ClickHouseService.instance;

  static get instance(): DashboardService {
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

  public async save(datasetId: number, dashboardUpdate: DashboardUpdate): Promise<void> {
    await this.entityManager
      .transaction(async (entityManager) => {
        const dataset = await DatasetService.instance.getById(datasetId);
        const user = await UserService.instance.getById(dashboardUpdate.user);

        let userDataset = new UserDataset();
        userDataset.dataset = dataset;
        userDataset.owner = user;
        userDataset.columns = [];

        userDataset = await entityManager.save(UserDataset, userDataset);

        // const ids = dashboardUpdate.colums.map((c) => c.id);

        // const dashboard = await entityManager.findOne(Dashboard, dashboardId, { relations: ['datasets'] });

        // dashboard.name = dashboardUpdate.name;
        // dashboard.goal = dashboardUpdate.goal;
        // dashboard.purpose = dashboardUpdate.purpose;

        // await entityManager.save(Dashboard, dashboard);

        // await entityManager.createQueryBuilder().delete().from(DatasetColumn).where('id not in (:...ids)', { ids }).andWhere('dataset_id = :dataset', { dataset: dashboard.datasets[0].id }).execute();

        for (const columnRequest of dashboardUpdate.colums) {
          const column = await entityManager.findOne(DatasetColumn, columnRequest.id);

          const userDatasetColumn = new UserDatasetColumn();
          userDatasetColumn.userDataset = userDataset;
          userDatasetColumn.column = column;
          userDatasetColumn.role = columnRequest.role;
          userDatasetColumn.index = columnRequest.index;
          userDatasetColumn.name = columnRequest.name;
          userDatasetColumn.removed = columnRequest.removed;

          await entityManager.save(UserDatasetColumn, userDatasetColumn);
        }

        const dashboard = new Dashboard();
        dashboard.userDatasets = [userDataset];
        dashboard.goalType = dashboardUpdate.goal;
        dashboard.goalPurpose = dashboardUpdate.purpose;
        dashboard.name = dashboardUpdate.name;

        await entityManager.save(Dashboard, dashboard);
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
}
