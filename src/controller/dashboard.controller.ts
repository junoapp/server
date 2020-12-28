import { Request, Response } from 'express';
import DashboardService from '../service/dashboard.service';

const dashboardService: DashboardService = DashboardService.instance;

export default class DashboardController {
  public async getSpec(request: Request, response: Response): Promise<void> {
    const datasets = await dashboardService.getChartRecommendation(+request.params.datasetId);

    response.send(datasets);
  }
}
