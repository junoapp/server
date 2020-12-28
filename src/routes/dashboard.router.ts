import * as multer from 'multer';
import DashboardController from '../controller/dashboard.controller';
import DatasetController from '../controller/dataset.controller';
import { getFilename } from '../utils/functions';
import { Router } from './router';

const dashboardController = new DashboardController();

export const dashboardRoutes: Router[] = [
  {
    path: 'dashboard/:datasetId/spec',
    method: 'get',
    action: dashboardController.getSpec,
  },
];
