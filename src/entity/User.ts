import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { UserDisability, UserInterface, UserVisLiteracy } from '@junoapp/common';

import { BasicColumns } from '../utils/basic-columns';

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
}
