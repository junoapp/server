import { Column, Entity, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { DatasetColumnInterface, DatasetColumnRole, DatasetColumnType, DatasetColumnExpandedType } from '@junoapp/common';

import { BasicColumns } from '../utils/basic-columns';
import { Dataset } from './Dataset';

@Entity()
export class DatasetColumn extends BasicColumns implements DatasetColumnInterface {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  index: number;

  @Column({ nullable: true })
  originalIndex: number;

  @Column()
  role: DatasetColumnRole;

  @Column()
  type: DatasetColumnType;

  @Column({ nullable: true })
  expandedType: DatasetColumnExpandedType;

  @Column()
  isPrimaryKey: boolean;

  @Column()
  isForeignKey: boolean;

  @Column()
  distinctValues: number;

  @Column()
  isCount: boolean;

  @ManyToOne((type) => Dataset, (dataset) => dataset.columns)
  dataset: Dataset;
}
