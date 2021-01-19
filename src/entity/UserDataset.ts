import { Entity, PrimaryGeneratedColumn, OneToMany, ManyToOne } from 'typeorm';
import { DashboardInterface, DatasetInterface, UserInterface } from '@junoapp/common';

import { BasicColumns } from '../utils/basic-columns';
import { Dashboard } from './Dashboard';
import { Dataset } from './Dataset';
import { UserDatasetColumn } from './UserDatasetColumn';
import { User } from './User';
import { UserDatasetInterface } from '@junoapp/common/dist/entity/UserDataset';
import { UserDatasetColumnInterface } from '@junoapp/common/dist/entity/UserDatasetColumn';

@Entity()
export class UserDataset extends BasicColumns implements UserDatasetInterface {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToMany((type) => UserDatasetColumn, (columns) => columns.userDataset)
  columns: UserDatasetColumnInterface[];

  @ManyToOne((type) => Dataset, (dataset) => dataset.userDatasets)
  dataset: DatasetInterface;

  @ManyToOne((type) => User, (user) => user.userDatasets)
  owner: UserInterface;

  @ManyToOne((type) => Dashboard, (dashboard) => dashboard.userDatasets)
  dashboard: DashboardInterface;
}
