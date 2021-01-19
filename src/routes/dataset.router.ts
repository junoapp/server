import * as multer from 'multer';
import DatasetController from '../controller/dataset.controller';
import { getFilename } from '../utils/functions';
import { Router } from './router';

const datasetController = new DatasetController();

const storage = multer.diskStorage({
  destination: (_, __, callback) => {
    callback(null, 'uploads/');
  },
  filename: function (_, file, callback) {
    const [name, extension] = getFilename(file.originalname);

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    callback(null, `${name}-${uniqueSuffix}.${extension}`);
  },
});

const uploader = multer({ storage });

export const datasetRoutes: Router[] = [
  {
    path: 'dataset',
    method: 'get',
    action: datasetController.getAll,
  },
  {
    path: 'dataset/:id',
    method: 'get',
    action: datasetController.getById,
  },
  {
    path: 'dataset/upload',
    method: 'post',
    middleware: uploader.single('file'),
    action: datasetController.upload,
  },
  {
    path: 'dataset/:id/columns',
    method: 'get',
    action: datasetController.getColumns,
  },
  {
    path: 'dataset/:id/columns',
    method: 'put',
    action: datasetController.updateColumns,
  },
  {
    path: 'dataset/:id',
    method: 'delete',
    action: datasetController.delete,
  },
];
