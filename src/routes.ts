import { datasetRoutes } from './routes/dataset.router';
import { dashboardRoutes } from './routes/dashboard.router';
import { userRoutes } from './routes/user.router';

export const AppRoutes = [...datasetRoutes, ...dashboardRoutes, ...userRoutes];
