import { DashboardGoal, DashboardInterface, DashboardPurpose, DatasetInterface, UserInterface } from '@junoapp/common';
import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BasicColumns } from '../utils/basic-columns';
import { Dataset } from './Dataset';
import { User } from './User';

@Entity()
export class Dashboard extends BasicColumns implements DashboardInterface {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  goal: DashboardGoal;

  @Column({ nullable: true })
  purpose: DashboardPurpose;

  @OneToMany((type) => Dataset, (columns) => columns.dashboard)
  datasets: DatasetInterface[];

  @ManyToOne((type) => User, (user) => user.dashboards)
  user: UserInterface;
}
