import { datasetRoutes } from './routes/dataset.router';
import { dashboardRecommendationRoutes } from './routes/dashboard-recommendation.router';
import { userRoutes } from './routes/user.router';
import { dashboardRoutes } from './routes/dashboard.router';

export const AppRoutes = [...datasetRoutes, ...dashboardRoutes, ...dashboardRecommendationRoutes, ...userRoutes];
