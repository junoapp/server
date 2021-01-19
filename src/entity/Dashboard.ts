import { DashboardGoal, DashboardInterface, DashboardPurpose, DatasetInterface, UserInterface } from '@junoapp/common';
import { UserDatasetInterface } from '@junoapp/common/dist/entity/UserDataset';
import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BasicColumns } from '../utils/basic-columns';
import { Dataset } from './Dataset';
import { User } from './User';
import { UserDataset } from './UserDataset';

@Entity()
export class Dashboard extends BasicColumns implements DashboardInterface {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  goalType: DashboardGoal;

  @Column({ nullable: true })
  goalPurpose: DashboardPurpose;

  @OneToMany((type) => UserDataset, (columns) => columns.dashboard)
  userDatasets: UserDatasetInterface[];
}
