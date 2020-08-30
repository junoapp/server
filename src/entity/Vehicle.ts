import { Column, Entity, ManyToOne } from 'typeorm';
import { VehicleDateDim } from './VehicleDateDim';
import { VehicleStoreDim } from './VehicleStoreDim';
import { VehicleClassDim } from './VehicleClassDim';

@Entity()
export class Vehicle {
  @ManyToOne((type) => VehicleDateDim, (date) => date.vehicles, {
    primary: true,
  })
  pickUpDate: VehicleDateDim;

  @ManyToOne((type) => VehicleStoreDim, (store) => store.vehicles, {
    primary: true,
  })
  store: VehicleStoreDim;

  @ManyToOne(
    (type) => VehicleClassDim,
    (vehicleClass) => vehicleClass.vehicles,
    { primary: true }
  )
  vehicleClass: VehicleClassDim;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  vehicleClassCount: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  occupancyCount: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  pickUpCount: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  dropOffCount: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  lorSum: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  lorCount: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  ticketPriceSum: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  ticketPriceCount: number;
}
