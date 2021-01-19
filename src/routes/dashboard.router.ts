import DashboardController from '../controller/dashboard.controller';
import { Router } from './router';

const dashboardController = new DashboardController();

export const dashboardRoutes: Router[] = [
  {
    path: 'dashboard',
    method: 'get',
    action: dashboardController.getAll,
  },
  {
    path: 'dashboard/:id',
    method: 'get',
    action: dashboardController.getById,
  },
  {
    path: 'dashboard/:id',
    method: 'post',
    action: dashboardController.save,
  },
  {
    path: 'dashboard/:id',
    method: 'delete',
    action: dashboardController.delete,
  },
];
