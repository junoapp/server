import { DatasetColumnInterface, DatasetColumnNumberType, DatasetColumnRole, DatasetSchemaAggregateFunction } from '@junoapp/common';
import { UserDatasetInterface } from '@junoapp/common/dist/entity/UserDataset';
import { UserDatasetColumnInterface } from '@junoapp/common';
import { Column, Entity, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';

import { BasicColumns } from '../utils/basic-columns';
import { DatasetColumn } from './DatasetColumn';
import { UserDataset } from './UserDataset';

@Entity()
export class UserDatasetColumn extends BasicColumns implements UserDatasetColumnInterface {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  role: DatasetColumnRole;

  @Column()
  index: number;

  @Column()
  removed: boolean;

  @Column({ nullable: true })
  numberType: DatasetColumnNumberType;

  @ManyToOne((type) => UserDataset, (dataset) => dataset.columns)
  userDataset: UserDatasetInterface;

  @ManyToOne((type) => DatasetColumn, (dataset) => dataset.userDatasetColumns)
  column: DatasetColumnInterface;

  @Column({ nullable: true })
  aggregate?: DatasetSchemaAggregateFunction;
}
