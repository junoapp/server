import { Column, Entity, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';

import { BasicColumns } from '../utils/basic-columns';
import { Dataset } from './Dataset';

@Entity()
export class DatasetColumn extends BasicColumns {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  dataType: DatasetDataType;

  @Column()
  index: number;

  @Column()
  type: DatasetColumnType;

  @ManyToOne((type) => Dataset, (dataset) => dataset.columns)
  dataset: Dataset;
}

export enum DatasetColumnType {
  DIMENSION = 'dimension',
  MEASURE = 'measure',
}

export enum DatasetDataType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  DATE = 'date',
}
