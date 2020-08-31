import { Column, Entity, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { BasicColumns } from '../utils/basic-columns';
import { DatasetColumn } from './DatasetColumn';

@Entity()
export class Dataset extends BasicColumns {
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

  @OneToMany((type) => DatasetColumn, (columns) => columns.dataset)
  columns: DatasetColumn[];
}
