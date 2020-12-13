import { Request, Response } from 'express';
import DashboardService from '../service/dashboard.service';

const dashboardService: DashboardService = DashboardService.instance;

export default class DashboardController {
  public async getAll(request: Request, response: Response): Promise<void> {
    const datasets = await dashboardService.getAll(+request.params.datasetId, request.params.name, request.params.value);

    response.send(datasets);
  }

  public async getSpec(request: Request, response: Response): Promise<void> {
    const datasets = await dashboardService.getSpec(+request.params.datasetId, request.body);

    response.send(datasets);
  }
}
