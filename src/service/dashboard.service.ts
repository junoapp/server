import { getManager, EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as datalib from 'datalib';
import { parse, unparse } from 'papaparse';
import { format, parse as dateParse } from 'date-fns';
import { DashboardInsert, DashboardInterface, DashboardUpdate, DatasetColumnExpandedType, DatasetColumnRole, DatasetColumnType, DatasetInterface } from '@junoapp/common';

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

  public async getAll(userId: number): Promise<DashboardInterface[]> {
    return this.entityManager
      .createQueryBuilder(Dashboard, 'dashboard')
      .leftJoinAndSelect('dashboard.userDatasets', 'userDatasets')
      .leftJoinAndSelect('userDatasets.columns', 'columns')
      .leftJoinAndSelect('columns.column', 'column')
      .leftJoinAndSelect('userDatasets.dataset', 'dataset')
      .leftJoinAndSelect('dataset.columns', 'datasetColumns')
      .leftJoinAndSelect('userDatasets.owner', 'owner')
      .where('owner.id = :id', { id: userId })
      .orderBy('dashboard.updatedDate', 'DESC')
      .getMany();
  }

  public async getById(id: number): Promise<DashboardInterface> {
    return this.entityManager
      .createQueryBuilder(Dashboard, 'dashboard')
      .leftJoinAndSelect('dashboard.userDatasets', 'userDatasets')
      .leftJoinAndSelect('userDatasets.columns', 'columns')
      .leftJoinAndSelect('columns.column', 'column')
      .leftJoinAndSelect('userDatasets.dataset', 'dataset')
      .leftJoinAndSelect('userDatasets.owner', 'owner')
      .leftJoinAndSelect('dataset.columns', 'datasetColumns')
      .where('dashboard.id = :id', { id })
      .orderBy('columns.role', 'ASC')
      .addOrderBy('columns.name', 'ASC')
      .getOne();
  }

  public async save(dashboardInsert: DashboardInsert): Promise<void> {
    await this.entityManager
      .transaction(async (entityManager) => {
        const dataset = await DatasetService.instance.getById(dashboardInsert.datasetId);
        const user = await UserService.instance.getById(dashboardInsert.user);

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

        for (const columnRequest of dashboardInsert.colums) {
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
        dashboard.goalType = dashboardInsert.goal;
        dashboard.goalPurpose = dashboardInsert.purpose;
        dashboard.name = dashboardInsert.name;

        await entityManager.save(Dashboard, dashboard);
      })
      .catch((error) => {
        console.log(error);
      });
  }

  public async update(dashboardUpdate: DashboardUpdate): Promise<void> {
    await this.entityManager
      .transaction(async (entityManager) => {
        const dashboard = await this.getById(dashboardUpdate.id);

        const dataset = await DatasetService.instance.getById(dashboard.userDatasets[0].dataset.id);
        const user = await UserService.instance.getById(dashboardUpdate.user);

        // let userDataset = new UserDataset();
        // userDataset.dataset = dataset;
        // userDataset.owner = user;
        // userDataset.columns = [];

        const userDataset = await entityManager.findOne(UserDataset, dashboard.userDatasets[0].id);

        // const ids = dashboardUpdate.colums.map((c) => c.id);

        // const dashboard = await entityManager.findOne(Dashboard, dashboardId, { relations: ['datasets'] });

        // dashboard.name = dashboardUpdate.name;
        // dashboard.goal = dashboardUpdate.goal;
        // dashboard.purpose = dashboardUpdate.purpose;

        // await entityManager.save(Dashboard, dashboard);

        // await entityManager.createQueryBuilder().delete().from(DatasetColumn).where('id not in (:...ids)', { ids }).andWhere('dataset_id = :dataset', { dataset: dashboard.datasets[0].id }).execute();

        for (const columnRequest of dashboardUpdate.colums) {
          const userDatasetColumn = await entityManager.findOne(UserDatasetColumn, columnRequest.id);

          // const userDatasetColumn = new UserDatasetColumn();
          // userDatasetColumn.userDataset = userDataset;
          // userDatasetColumn.column = column;
          userDatasetColumn.role = columnRequest.role;
          userDatasetColumn.index = columnRequest.index;
          userDatasetColumn.name = columnRequest.name;
          userDatasetColumn.removed = columnRequest.removed;

          await entityManager.save(UserDatasetColumn, userDatasetColumn);
        }

        // const dashboard = new Dashboard();
        // dashboard.userDatasets = [userDataset];
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
    const dashboard = await this.getById(id);

    await this.entityManager.transaction(async (entityManager) => {
      await entityManager.delete(DatasetColumn, { dataset: dashboard.id });
      await entityManager.delete(Dataset, dashboard.id);

      try {
        fs.unlinkSync(dashboard.userDatasets[0].dataset.path);
      } catch (error) {
        logger.error('Some file does not exist');
      }
    });
  }
}
