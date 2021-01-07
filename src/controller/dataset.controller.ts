import { Request, Response } from 'express';

import DatasetService from '../service/dataset.service';

const datasetService: DatasetService = DatasetService.instance;

export default class DatasetController {
  public async getAll(request: Request, response: Response): Promise<void> {
    const datasets = await datasetService.getAll(+request.params.id);

    response.send(datasets);
  }

  public async getById(request: Request, response: Response): Promise<void> {
    const dataset = await datasetService.getById(+request.params.id);

    response.send(dataset);
  }

  public async upload(request: Request, response: Response): Promise<void> {
    if (request.file) {
      console.log(request.body.user);
      const dataset = await datasetService.upload(+request.body.user, request.file);
      response.send(dataset);
    } else {
      response.status(400).send({ error: 'File not found' });
    }
  }

  public async getColumns(request: Request, response: Response): Promise<void> {
    const columns = await datasetService.getColumns(+request.params.id);

    response.send(columns);
  }

  public async updateColumns(request: Request, response: Response): Promise<void> {
    await datasetService.updateColumns(+request.params.id, request.body);

    response.send();
  }

  public async delete(request: Request, response: Response): Promise<void> {
    await datasetService.delete(+request.params.id);

    response.send();
  }
}
