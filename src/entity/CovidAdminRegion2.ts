import { Entity, PrimaryColumn, OneToMany, ManyToOne, Column } from 'typeorm';
import { Covid } from './Covid';
import { CovidCountryDim } from './CovidCountryDim';
import { CovidAdminRegion1Dim } from './CovidAdminRegion1';

@Entity()
export class CovidAdminRegion2Dim {
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

  @ManyToOne((type) => CovidAdminRegion1Dim, (store) => store.covid)
  adminRegion1: CovidAdminRegion1Dim;

  @OneToMany((type) => Covid, (covid) => covid.adminRegion2)
  covid: Covid[];
}
