import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export abstract class BasicColumns {
  @CreateDateColumn()
  createdDate: Date;

  @UpdateDateColumn()
  updatedDate: Date;
}
