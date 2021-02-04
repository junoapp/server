import UserController from '../controller/user.controller';
import { Router } from './router';

const userController = new UserController();

export const userRoutes: Router[] = [
  {
    path: 'user',
    method: 'get',
    action: userController.getAll,
  },
  {
    path: 'user/:id',
    method: 'get',
    action: userController.getById,
  },
  {
    path: 'user',
    method: 'post',
    action: userController.save,
  },
  {
    path: 'user/:id',
    method: 'delete',
    action: userController.delete,
  },
  {
    path: 'user/preferences/:id',
    method: 'post',
    action: userController.savePreferences,
  },
];
