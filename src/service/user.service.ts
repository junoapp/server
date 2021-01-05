import { getManager, EntityManager } from 'typeorm';
import { UserDTO } from '@junoapp/common';

import { User } from '../entity/User';

export default class UserService {
  private static singletonInstance: UserService;

  static get instance(): UserService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {}

  private get entityManager(): EntityManager {
    return getManager();
  }

  public async getAll(): Promise<User[]> {
    return this.entityManager.find(User, { order: { updatedDate: 'DESC' } });
  }

  public async getById(id: number): Promise<User> {
    return this.entityManager.createQueryBuilder(User, 'user').where('user.id = :id', { id }).getOne();
  }

  public async save(userDTO: UserDTO): Promise<User> {
    let user = new User();
    user.name = userDTO.name;
    user.disability = userDTO.disability;
    user.visLiteracy = userDTO.visLiteracy;

    return await this.entityManager.save(User, user);
  }

  public async delete(id: number): Promise<void> {
    await this.entityManager.delete(User, id);
  }
}
