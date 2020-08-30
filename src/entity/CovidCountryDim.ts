import { Entity, PrimaryColumn, OneToMany, Column } from 'typeorm';
import { Covid } from './Covid';

@Entity()
export class CovidCountryDim {
  @PrimaryColumn()
  id: string;

  @Column({ nullable: true })
  iso2: string;

  @Column({ nullable: true })
  iso3: string;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  latitude: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  longitude: number;

  @OneToMany((type) => Covid, (covid) => covid.country)
  covid: Covid[];
}
