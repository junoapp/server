import DashboardController from '../controller/dashboard.controller';
import { Router } from './router';

const dashboardController = new DashboardController();

export const dashboardRoutes: Router[] = [
  {
    path: 'dashboard/:datasetId/spec',
    method: 'get',
    action: dashboardController.getSpec,
  },
];
