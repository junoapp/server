import { Request, Response } from 'express';

import NanocubeService from '../service/nanocube.service';

const nanocubeService: NanocubeService = NanocubeService.instance;

export default class NanocubeController {
  public async generateMap(request: Request, response: Response): Promise<void> {
    const output = await nanocubeService.generateMap(+request.params.id);

    response.send(output);
  }

  public async stopServer(request: Request, response: Response): Promise<void> {
    await nanocubeService.stopServer();

    response.send();
  }
}
