import { Entity, PrimaryColumn, OneToMany, ManyToOne, Column } from 'typeorm';
import { Covid } from './Covid';
import { CovidCountryDim } from './CovidCountryDim';

@Entity()
export class CovidAdminRegion1Dim {
  @PrimaryColumn()
  id: string;

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

  @ManyToOne((type) => CovidCountryDim, (store) => store.covid)
  country: CovidCountryDim;

  @OneToMany((type) => Covid, (covid) => covid.adminRegion1)
  covid: Covid[];
}
