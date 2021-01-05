import { Request, Response } from 'express';

import UserService from '../service/user.service';

const userService: UserService = UserService.instance;

export default class UserController {
  public async getAll(request: Request, response: Response): Promise<void> {
    const users = await userService.getAll();

    response.send(users);
  }

  public async getById(request: Request, response: Response): Promise<void> {
    const user = await userService.getById(+request.params.id);

    response.send(user);
  }

  public async save(request: Request, response: Response): Promise<void> {
    const user = await userService.save(request.body);
    response.send(user);
  }

  public async delete(request: Request, response: Response): Promise<void> {
    await userService.delete(+request.params.id);

    response.send();
  }
}
