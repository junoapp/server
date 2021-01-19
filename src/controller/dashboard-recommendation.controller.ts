import { Request, Response } from 'express';
import DashboardRecommendationService from '../service/dashboard-recommendation.service';

const dashboardRecommendationService: DashboardRecommendationService = DashboardRecommendationService.instance;

export default class DashboardRecommendationController {
  public async getSpec(request: Request, response: Response): Promise<void> {
    const datasets = await dashboardRecommendationService.getChartRecommendation(+request.params.datasetId);

    response.send(datasets);
  }
}
