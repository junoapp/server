import { Column, Entity, JoinColumn, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DashboardInterface, UserDisability, UserInterface, UserPreferencesInterface, UserVisLiteracy } from '@junoapp/common';

import { BasicColumns } from '../utils/basic-columns';
import { Dashboard } from './Dashboard';
import { Dataset } from './Dataset';
import { UserDataset } from './UserDataset';
import { UserPreferences } from './UserPreferences';

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

  @OneToMany((type) => Dataset, (columns) => columns.addedBy)
  datasets: Dataset[];

  @OneToMany((type) => UserDataset, (columns) => columns.owner)
  userDatasets: UserDataset[];

  @OneToOne((type) => UserPreferences, (preference) => preference.user)
  preferences: UserPreferencesInterface;
}
