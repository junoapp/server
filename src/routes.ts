import { datasetRoutes } from './routes/dataset.router';
import { dashboardRoutes } from './routes/dashboard.router';

export const AppRoutes = [...datasetRoutes, ...dashboardRoutes];
