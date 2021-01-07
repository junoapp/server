import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { DashboardInterface, UserDisability, UserInterface, UserVisLiteracy } from '@junoapp/common';

import { BasicColumns } from '../utils/basic-columns';
import { Dashboard } from './Dashboard';

@Entity()
export class User extends BasicColumns implements UserInterface {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  disability?: UserDisability;

  @Column()
  visLiteracy: UserVisLiteracy;

  @OneToMany((type) => Dashboard, (columns) => columns.user)
  dashboards: DashboardInterface[];
}
