import 'reflect-metadata';
import { createConnection, getConnectionOptions } from 'typeorm';
import { Request, Response } from 'express';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as morgan from 'morgan';

import { AppRoutes } from './routes';
import logger from './utils/logger';
import { SnakeNamingStrategy } from './utils/snake-case-strategy';
import { Dataset } from './entity/Dataset';
import { DatasetColumn } from './entity/DatasetColumn';
import { User } from './entity/User';
import { Dashboard } from './entity/Dashboard';
import { UserDataset } from './entity/UserDataset';
import { UserDatasetColumn } from './entity/UserDatasetColumn';

const PORT = process.env.PORT || 3001;

// const options = require('../ormconfig.json');

// getConnectionOptions().then((options) => {
createConnection({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'pricing',
  password: 'test',
  database: 'juno',
  synchronize: true,
  logging: false,
  entities: [Dataset, DatasetColumn, User, Dashboard, UserDataset, UserDatasetColumn],
  migrations: ['src/migration/**/*.ts'],
  subscribers: ['src/subscriber/**/*.ts'],
  cli: {
    entitiesDir: 'src/entity',
    migrationsDir: 'src/migration',
    subscribersDir: 'src/subscriber',
  },
  namingStrategy: new SnakeNamingStrategy(),
})
  .then(async () => {
    const app = express();

    app.use(bodyParser.json());
    app.use(cors());
    app.use(morgan('dev'));

    logger.info('Loading routes...');
    AppRoutes.forEach((route) => {
      const path = `/api/${route.path}`;
      logger.info(`${route.method.toUpperCase()} - ${path}`);

      if (route.middleware) {
        app[route.method](path, route.middleware, (request: Request, response: Response, next: Function) => {
          route
            .action(request, response)
            .then(() => next)
            .catch((err) => next(err));
        });
      } else {
        app[route.method](path, (request: Request, response: Response, next: Function) => {
          route
            .action(request, response)
            .then(() => next)
            .catch((err) => next(err));
        });
      }
    });

    app.listen(PORT);

    logger.info(`Running on port ${PORT}`);
  })
  .catch((error) => logger.error(error));
// });
