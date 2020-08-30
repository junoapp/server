import { Entity, PrimaryColumn, OneToMany } from 'typeorm';
import { Vehicle } from './Vehicle';

@Entity()
export class VehicleDateDim {
  @PrimaryColumn()
  id: Date;

  @OneToMany((type) => Vehicle, (vehicle) => vehicle.pickUpDate)
  vehicles: Vehicle[];
}
