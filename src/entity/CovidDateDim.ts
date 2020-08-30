import { Entity, PrimaryColumn, OneToMany } from 'typeorm';
import { Covid } from './Covid';

@Entity()
export class CovidDateDim {
  @PrimaryColumn()
  id: Date;

  @OneToMany((type) => Covid, (covid) => covid.updated)
  covid: Covid[];
}
