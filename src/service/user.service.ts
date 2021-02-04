import { getManager, EntityManager } from 'typeorm';
import { UserDTO } from '@junoapp/common';

import { User } from '../entity/User';
import { UserPreferences, UserPreferencesChartType } from '../entity/UserPreferences';

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
    return this.entityManager
      .createQueryBuilder(User, 'user')
      .leftJoinAndSelect('user.preferences', 'preferences')
      .leftJoinAndSelect('preferences.chartTypes', 'chartTypes')
      .where('user.id = :id', { id })
      .getOne();
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

  public async savePreferences(userID: number, preferences: any): Promise<void> {
    const user = await this.getById(userID);

    let userPreference = user.preferences;

    if (!userPreference) {
      userPreference = new UserPreferences();
    }

    userPreference.user = user;
    userPreference.stacked = preferences.stacked;
    userPreference.multiline = preferences.multiline;
    userPreference.rightAxis = preferences.rightAxis;
    userPreference.binValues = preferences.binValues;
    userPreference.clampStrings = preferences.clampStrings;
    userPreference.chartTypes = [];

    userPreference = await this.entityManager.save(UserPreferences, userPreference);

    user.preferences = userPreference;
    await this.entityManager.save(User, user);

    await this.entityManager.createQueryBuilder().delete().from(UserPreferencesChartType).where('user_preference_id is null').execute();

    for (const prefChartType of preferences.chartTypes) {
      const chartType = new UserPreferencesChartType();
      chartType.typeX = prefChartType.typeX;
      chartType.typeY = prefChartType.typeY;
      chartType.chart = prefChartType.chart;
      chartType.userPreference = userPreference;

      await this.entityManager.save(UserPreferencesChartType, chartType);
    }
  }
}
