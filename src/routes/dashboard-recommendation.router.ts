import DashboardRecommendationController from '../controller/dashboard-recommendation.controller';
import { Router } from './router';

const dashboardRecommendationController = new DashboardRecommendationController();

export const dashboardRecommendationRoutes: Router[] = [
  {
    path: 'dashboard-recommendation/:datasetId/spec',
    method: 'get',
    action: dashboardRecommendationController.getSpec,
  },
];
