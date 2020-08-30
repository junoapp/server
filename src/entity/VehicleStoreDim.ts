import { Entity, PrimaryColumn, OneToMany } from 'typeorm';
import { Vehicle } from './Vehicle';

@Entity()
export class VehicleStoreDim {
  @PrimaryColumn()
  id: string;

  @OneToMany((type) => Vehicle, (vehicle) => vehicle.store)
  vehicles: Vehicle[];
}
