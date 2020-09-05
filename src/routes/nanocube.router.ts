import NanocubeController from '../controller/nanocube.controller';
import { Router } from './router';

const nanocubeController = new NanocubeController();

export const nanocubeRoutes: Router[] = [
  {
    path: 'nanocube/stop',
    method: 'get',
    action: nanocubeController.stopServer,
  },
  {
    path: 'nanocube/:id',
    method: 'get',
    action: nanocubeController.generateMap,
  },
];
