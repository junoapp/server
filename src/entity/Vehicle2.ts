import { Column, Entity, ManyToOne } from 'typeorm';
import { VehicleDateDim } from './VehicleDateDim';
import { VehicleStoreDim } from './VehicleStoreDim';
import { VehicleClassDim } from './VehicleClassDim';

@Entity()
export class Vehicle2 {
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
  occupancy: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  pickUp: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  lor: number;

  @Column({
    type: 'numeric',
    nullable: true,
  })
  ticketPrice: number;
}
