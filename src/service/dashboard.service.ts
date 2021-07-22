import { getManager, EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as datalib from 'datalib';
import { parse, unparse } from 'papaparse';
import { addDays, format, parse as dateParse } from 'date-fns';
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

  private rnd(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  public async getAll(userId: number): Promise<DashboardInterface[]> {
    // let startDate = new Date(2021, 1, 1, 10, 0, 0);
    // const stores = ['REC', 'SAO', 'RIO', 'CWB'];
    // const vehicleClasses = ['A', 'B', 'D', 'D+'];

    // const data = {
    //   lor: {},
    //   occupancy: {},
    //   pick_up: {},
    //   ticket_price: {},
    // };

    // for (let day = 0; day < 500; day++) {
    //   for (const store of stores) {
    //     for (const vehicleClass of vehicleClasses) {
    //       if (!data.lor[`${store}-${vehicleClass}`]) {
    //         data.lor[`${store}-${vehicleClass}`] = this.rnd(1, 45);
    //       }

    //       if (!data.occupancy[`${store}-${vehicleClass}`]) {
    //         data.occupancy[`${store}-${vehicleClass}`] = this.rnd(0, 100);
    //       }

    //       if (!data.pick_up[`${store}-${vehicleClass}`]) {
    //         data.pick_up[`${store}-${vehicleClass}`] = this.rnd(0, 100);
    //       }

    //       if (!data.ticket_price[`${store}-${vehicleClass}`]) {
    //         data.ticket_price[`${store}-${vehicleClass}`] = this.rnd(50, 500);
    //       }

    //       this.entityManager.query(`
    //         INSERT INTO public.vehicles ("date", store, vehicle_class, lor, occupancy, pick_up, ticket_price)
    //         VALUES(
    //           '${format(startDate, 'yyyy-MM-dd HH:mm:ss')}',
    //           '${store}',
    //           '${vehicleClass}',
    //           ${data.lor[`${store}-${vehicleClass}`]},
    //           ${data.occupancy[`${store}-${vehicleClass}`]},
    //           ${data.pick_up[`${store}-${vehicleClass}`]},
    //           ${data.ticket_price[`${store}-${vehicleClass}`]}
    //         );
    //       `);

    //       data.lor[`${store}-${vehicleClass}`] = Math.max(this.rnd(data.lor[`${store}-${vehicleClass}`] - 2, data.lor[`${store}-${vehicleClass}`] + 2), 1);
    //       data.occupancy[`${store}-${vehicleClass}`] = Math.max(this.rnd(data.occupancy[`${store}-${vehicleClass}`] - 10, data.occupancy[`${store}-${vehicleClass}`] + 10), 0);
    //       data.pick_up[`${store}-${vehicleClass}`] = Math.max(this.rnd(data.pick_up[`${store}-${vehicleClass}`] - 10, data.pick_up[`${store}-${vehicleClass}`] + 10), 0);
    //       data.ticket_price[`${store}-${vehicleClass}`] = Math.max(this.rnd(data.ticket_price[`${store}-${vehicleClass}`] - 40, data.ticket_price[`${store}-${vehicleClass}`] + 50), 50);
    //     }
    //   }

    //   startDate = addDays(startDate, 1);
    // }

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
      .leftJoinAndSelect('owner.preferences', 'preferences')
      .leftJoinAndSelect('preferences.chartTypes', 'chartTypes')
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

        for (const columnRequest of dashboardInsert.colums) {
          const column = await entityManager.findOne(DatasetColumn, columnRequest.id);

          const userDatasetColumn = new UserDatasetColumn();
          userDatasetColumn.userDataset = userDataset;
          userDatasetColumn.column = column;
          userDatasetColumn.role = columnRequest.role;
          userDatasetColumn.index = columnRequest.index;
          userDatasetColumn.name = columnRequest.name;
          userDatasetColumn.removed = columnRequest.removed;
          userDatasetColumn.aggregate = columnRequest.aggregate;

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

        for (const columnRequest of dashboardUpdate.colums) {
          const userDatasetColumn = await entityManager.findOne(UserDatasetColumn, columnRequest.id);

          userDatasetColumn.role = columnRequest.role;
          userDatasetColumn.index = columnRequest.index;
          userDatasetColumn.name = columnRequest.name;
          userDatasetColumn.removed = columnRequest.removed;
          userDatasetColumn.aggregate = columnRequest.aggregate;

          await entityManager.save(UserDatasetColumn, userDatasetColumn);
        }

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
