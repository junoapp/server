import { datasetRoutes } from './routes/dataset.router';
import { nanocubeRoutes } from './routes/nanocube.router';

export const AppRoutes = [...datasetRoutes, ...nanocubeRoutes];
