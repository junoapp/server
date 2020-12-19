import { CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { BasicColumnsInterface } from '@junoapp/common';

export abstract class BasicColumns implements BasicColumnsInterface {
  @CreateDateColumn()
  createdDate: Date;

  @UpdateDateColumn()
  updatedDate: Date;
}
