import { Column, Entity, PrimaryGeneratedColumn, OneToMany, ManyToOne } from 'typeorm';
import { DashboardInterface, DatasetInterface, UserInterface } from '@junoapp/common';

import { BasicColumns } from '../utils/basic-columns';
import { DatasetColumn } from './DatasetColumn';
import { Dashboard } from './Dashboard';
import { UserDataset } from './UserDataset';
import { User } from './User';
import { UserDatasetInterface } from '@junoapp/common/dist/entity/UserDataset';
import { UserDatasetColumnInterface } from '@junoapp/common/dist/entity/UserDatasetColumn';
import { UserDatasetColumn } from './UserDatasetColumn';

@Entity()
export class Dataset extends BasicColumns implements DatasetInterface {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  path: string;

  @Column()
  fieldname: string;

  @Column()
  originalname: string;

  @Column()
  encoding: string;

  @Column()
  mimetype: string;

  @Column()
  size: number;

  @Column()
  destination: string;

  @Column()
  filename: string;

  @Column({ nullable: true })
  tableName: string;

  @OneToMany((type) => DatasetColumn, (columns) => columns.dataset)
  columns: DatasetColumn[];

  @OneToMany((type) => UserDataset, (userDatasets) => userDatasets.dataset)
  userDatasets: UserDatasetInterface[];

  @ManyToOne((type) => User, (user) => user.datasets)
  addedBy: UserInterface;
}
