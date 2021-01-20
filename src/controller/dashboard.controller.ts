import { Request, Response } from 'express';
import DashboardService from '../service/dashboard.service';

const dashboardService: DashboardService = DashboardService.instance;

export default class DashboardController {
  public async getAll(request: Request, response: Response): Promise<void> {
    const dashboards = await dashboardService.getAll(+request.query.user);

    response.send(dashboards);
  }

  public async getById(request: Request, response: Response): Promise<void> {
    const dashboard = await dashboardService.getById(+request.params.id);

    response.send(dashboard);
  }

  public async save(request: Request, response: Response): Promise<void> {
    await dashboardService.save(request.body);

    response.send();
  }

  public async update(request: Request, response: Response): Promise<void> {
    await dashboardService.update(request.body);

    response.send();
  }

  public async delete(request: Request, response: Response): Promise<void> {
    await dashboardService.delete(+request.params.id);

    response.send();
  }
}
