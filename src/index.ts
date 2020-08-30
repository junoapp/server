import 'reflect-metadata';
import { createConnection, Connection } from 'typeorm';

import * as datalib from 'datalib';
import { readFileSync } from 'fs';

import { Vehicle } from './entity/Vehicle';
import { VehicleDateDim } from './entity/VehicleDateDim';
import { VehicleStoreDim } from './entity/VehicleStoreDim';
import { VehicleClassDim } from './entity/VehicleClassDim';

import { CovidDateDim } from './entity/CovidDateDim';
import { CovidCountryDim } from './entity/CovidCountryDim';
import { CovidAdminRegion1Dim } from './entity/CovidAdminRegion1';
import { CovidAdminRegion2Dim } from './entity/CovidAdminRegion2';
import { Covid } from './entity/Covid';
import { Vehicle2 } from './entity/Vehicle2';

async function insertVehicle(connection: Connection) {
  const file = readFileSync('../dataset/vehicles.csv');
  const data = datalib.read(file, { type: 'csv', parse: 'auto' });

  console.log(data[0]);

  for (const item of data) {
    const dateDim = new VehicleDateDim();
    dateDim.id = new Date(item.pick_up_date);

    await connection.manager.save(dateDim);

    const storeDim = new VehicleStoreDim();
    storeDim.id = item.store;

    await connection.manager.save(storeDim);

    const vehicleClassDim = new VehicleClassDim();
    vehicleClassDim.id = item.vehicle_class;

    await connection.manager.save(vehicleClassDim);

    const vehicle = new Vehicle();
    vehicle.pickUpDate = dateDim;
    vehicle.store = storeDim;
    vehicle.vehicleClass = vehicleClassDim;
    vehicle.vehicleClassCount = item.vehicle_class_count;
    vehicle.occupancyCount = item.occupancy_count;
    vehicle.pickUpCount = item.pick_up_count;
    vehicle.dropOffCount = item.drop_off_count;
    vehicle.lorSum = item.lor_sum;
    vehicle.lorCount = item.lor_count;
    vehicle.ticketPriceSum = item.ticket_price_sum;
    vehicle.ticketPriceCount = item.ticket_price_count;

    await connection.manager.save(vehicle);
  }
}

async function insertCovid(connection: Connection) {
  const file = readFileSync('../dataset/bing-covid-19.csv');
  const data = datalib.read(file, { type: 'csv', parse: 'auto' });

  let dates = {};
  let countries = {};
  let admin1 = {};
  let admin2 = {};

  console.log(data[0]);

  for (let i = 0; i < data.length; i++) {
    const item = data[i];

    const dateDim = new CovidDateDim();
    dateDim.id = new Date(item.Updated);
    if (!dates[item.Updated]) {
      await connection.manager.save(dateDim);
    } else {
      dates[item.Updated] = 1;
    }

    const countryDim = new CovidCountryDim();
    countryDim.id = item.Country_Region;
    if (!countries[item.Updated]) {
      countryDim.iso2 = item.ISO2;
      countryDim.iso3 = item.ISO3;
      countryDim.latitude = item.Latitude;
      countryDim.longitude = item.Longitude;
      await connection.manager.save(countryDim);
    } else {
      countries[item.Country_Region] = 1;
    }

    let covidAdminRegion1Dim: CovidAdminRegion1Dim;
    if (item.AdminRegion1) {
      covidAdminRegion1Dim = new CovidAdminRegion1Dim();
      covidAdminRegion1Dim.id = item.AdminRegion1;
      covidAdminRegion1Dim.latitude = item.Latitude;
      covidAdminRegion1Dim.longitude = item.Longitude;
      if (!admin1[item.Updated]) {
        covidAdminRegion1Dim.country = countryDim;
        await connection.manager.save(covidAdminRegion1Dim);
      } else {
        admin1[item.AdminRegion1] = 1;
      }
    }

    let covidAdminRegion2Dim: CovidAdminRegion2Dim;
    if (item.AdminRegion2) {
      covidAdminRegion2Dim = new CovidAdminRegion2Dim();
      covidAdminRegion2Dim.id = item.AdminRegion2;
      covidAdminRegion2Dim.latitude = item.Latitude;
      covidAdminRegion2Dim.longitude = item.Longitude;
      if (!admin2[item.Updated]) {
        covidAdminRegion2Dim.country = countryDim;
        covidAdminRegion2Dim.adminRegion1 = covidAdminRegion1Dim;
        await connection.manager.save(covidAdminRegion2Dim);
      } else {
        admin2[item.AdminRegion2] = 1;
      }
    }

    const covid = new Covid();
    covid.id = item.ID;
    covid.updated = dateDim;
    covid.country = countryDim;
    covid.adminRegion1 = covidAdminRegion1Dim;
    covid.adminRegion2 = covidAdminRegion2Dim;
    covid.confirmed = item.Confirmed;
    covid.deaths = item.Deaths;
    covid.recovered = item.Recovered;

    await connection.manager.save(covid);

    console.log(i);
  }
}

async function insertVehicle2(connection: Connection) {
  const file = readFileSync('../dataset/vehicles.csv');
  const data = datalib.read(file, { type: 'csv', parse: 'auto' });

  console.log(data[0]);

  for (const item of data) {
    const dateDim = new VehicleDateDim();
    dateDim.id = new Date(item.pick_up_date);

    await connection.manager.save(dateDim);

    const storeDim = new VehicleStoreDim();
    storeDim.id = item.store;

    await connection.manager.save(storeDim);

    const vehicleClassDim = new VehicleClassDim();
    vehicleClassDim.id = item.vehicle_class;

    await connection.manager.save(vehicleClassDim);

    const vehicle = new Vehicle2();
    vehicle.pickUpDate = dateDim;
    vehicle.store = storeDim;
    vehicle.vehicleClass = vehicleClassDim;
    // vehicle.vehicleClassCount = item.vehicle_class_count;
    vehicle.occupancy =
      item.occupancy_count && item.vehicle_class_count
        ? (item.occupancy_count / item.vehicle_class_count) * 100
        : null;
    vehicle.pickUp =
      item.pick_up_count && item.vehicle_class_count
        ? (item.pick_up_count / item.vehicle_class_count) * 100
        : null;
    // vehicle.dropOffCount = item.drop_off_count;
    vehicle.lor =
      item.lor_sum && item.lor_count ? item.lor_sum / item.lor_count : null;
    // vehicle.lorCount = item.lor_count;
    vehicle.ticketPrice =
      item.ticket_price_sum && item.ticket_price_count
        ? item.ticket_price_sum / item.ticket_price_count
        : null;
    // vehicle.ticketPriceCount = item.ticket_price_count;

    await connection.manager.save(vehicle);
  }
}

createConnection()
  .then(async (connection) => {
    await insertCovid(connection);
  })
  .catch((error) => console.log(error));
