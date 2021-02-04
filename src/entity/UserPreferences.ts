import { UserPreferencesChartTypeInterface, UserPreferencesInterface } from '@junoapp/common';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from './User';

@Entity()
export class UserPreferences implements UserPreferencesInterface {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne((type) => User, (user) => user.preferences)
  @JoinColumn()
  user: User;

  @Column()
  stacked: boolean;

  @Column()
  multiline: boolean;

  @Column()
  rightAxis: boolean;

  @Column()
  binValues: number;

  @Column()
  clampStrings: number;

  @OneToMany((type) => UserPreferencesChartType, (chartType) => chartType.userPreference)
  chartTypes: UserPreferencesChartTypeInterface[];
}

@Entity()
export class UserPreferencesChartType implements UserPreferencesChartTypeInterface {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  typeX: PreferenceType;

  @Column()
  typeY: PreferenceType;

  @Column()
  chart: PreferenceType;

  @ManyToOne((type) => UserPreferences, (user) => user.chartTypes)
  userPreference: UserPreferencesInterface;
}

export enum PreferenceType {
  Number = 'NUMBER',
  String = 'STRING',
  Date = 'DATE',
}

export enum PreferenceType {
  Auto = 'AUTO',
  Line = 'LINE',
  Bar = 'BAR',
}
