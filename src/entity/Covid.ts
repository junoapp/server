import { Column, Entity, ManyToOne, PrimaryColumn } from 'typeorm';

import { CovidDateDim } from './CovidDateDim';
import { CovidCountryDim } from './CovidCountryDim';
import { CovidAdminRegion1Dim } from './CovidAdminRegion1';
import { CovidAdminRegion2Dim } from './CovidAdminRegion2';

@Entity()
export class Covid {
  @PrimaryColumn()
  id: number;

  @ManyToOne((type) => CovidDateDim, (date) => date.covid)
  updated: CovidDateDim;

  @ManyToOne((type) => CovidCountryDim, (store) => store.covid)
  country: CovidCountryDim;

  @ManyToOne((type) => CovidAdminRegion1Dim, (store) => store.covid)
  adminRegion1: CovidAdminRegion1Dim;

  @ManyToOne((type) => CovidAdminRegion2Dim, (store) => store.covid)
  adminRegion2: CovidAdminRegion2Dim;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  confirmed: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  deaths: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  recovered: number;
}
