import { Entity, PrimaryColumn, OneToMany } from 'typeorm';
import { Vehicle } from './Vehicle';

@Entity()
export class VehicleClassDim {
  @PrimaryColumn()
  id: string;

  @OneToMany((type) => Vehicle, (vehicle) => vehicle.vehicleClass)
  vehicles: Vehicle[];
}
