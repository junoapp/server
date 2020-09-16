import { getManager, EntityManager } from 'typeorm';
import * as fs from 'fs';

import { Dataset } from '../entity/Dataset';
import { UploadResponse } from '../dto/upload-response';
import { DatasetColumn } from '../entity/DatasetColumn';
import { DatasetColumnRequest } from '../dto/dataset-column-request';
import logger from '../utils/logger';

export default class DatasetService {
  private static singletonInstance: DatasetService;

  static get instance(): DatasetService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {}

  private get entityManager(): EntityManager {
    return getManager();
  }

  public async getAll(): Promise<Dataset[]> {
    return this.entityManager.find(Dataset, { relations: ['columns'], order: { updatedDate: 'DESC' } });
  }

  public async getById(id: number): Promise<Dataset> {
    return this.entityManager.findOne(Dataset, { where: { id }, relations: ['columns'], order: { updatedDate: 'DESC' } });
  }

  public async upload(file: Express.Multer.File): Promise<Dataset> {
    let dataset = new Dataset();
    dataset.path = file.path;
    dataset.fieldname = file.fieldname;
    dataset.originalname = file.originalname;
    dataset.encoding = file.encoding;
    dataset.mimetype = file.mimetype;
    dataset.size = file.size;
    dataset.destination = file.destination;
    dataset.filename = file.filename;

    dataset = await this.entityManager.save(Dataset, dataset);

    return dataset;
  }

  public async getColumns(id: number): Promise<UploadResponse> {
    const dataset = await this.getById(id);

    const fileData = fs.readFileSync(dataset.path, 'utf8');
    const lines = fileData.split(/\r?\n/);

    const header = lines[0].replace(/\"/g, '').split(',');

    return {
      id: dataset.id,
      name: dataset.originalname,
      fields: header,
    };
  }

  public async updateColumns(datasetId: number, columns: DatasetColumnRequest[]): Promise<void> {
    await this.entityManager.transaction(async (entityManager) => {
      const dataset = await entityManager.findOne(Dataset, datasetId);
      await entityManager.delete(DatasetColumn, { dataset: dataset.id });

      for (const column of columns) {
        const newColumn = new DatasetColumn();
        newColumn.name = column.name;
        newColumn.type = column.type;
        newColumn.dataset = dataset;
        newColumn.index = column.index;

        await entityManager.save(DatasetColumn, newColumn);
      }
    });
  }

  public async delete(id: number): Promise<void> {
    const dataset = await this.getById(id);

    await this.entityManager.transaction(async (entityManager) => {
      await entityManager.delete(DatasetColumn, { dataset: id });
      await entityManager.delete(Dataset, id);

      try {
        fs.unlinkSync(dataset.path);
        if (dataset.nanocubeMapPath) {
          fs.unlinkSync(dataset.nanocubeMapPath);
        }
        if (dataset.nanocubeFilePath) {
          fs.unlinkSync(dataset.nanocubeFilePath);
        }
      } catch (error) {
        logger.error('Some file does not exist');
      }
    });
  }
}
