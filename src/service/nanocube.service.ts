import { getManager, EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as datalib from 'datalib';
import { exec, spawn } from 'child_process';

import DatasetService from './dataset.service';
import { DatasetColumnType } from '../entity/DatasetColumn';
import { Dataset } from '../entity/Dataset';
import logger from '../utils/logger';

export default class NanocubeService {
  private static singletonInstance: NanocubeService;
  private GENERATING_NANOCUBE = false;
  private SERVER_PID: number;

  static get instance(): NanocubeService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {}

  private get entityManager(): EntityManager {
    return getManager();
  }

  public async stopServer(): Promise<void> {
    if (this.SERVER_PID) {
      const kill = spawn('kill', [this.SERVER_PID.toString()]);

      kill.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
      });

      kill.stderr.on('data', (data) => {
        console.log(`stderr: ${data}`);
      });

      kill.on('error', (error) => {
        console.log(`error: ${error.message}`);
      });

      kill.on('close', (code) => {
        this.SERVER_PID = undefined;
        this.GENERATING_NANOCUBE = false;

        console.log(`child process exited with code ${code}`);
      });
    }
  }

  public async generateMap(datasetId: number): Promise<{ status: number; message: string }> {
    if (this.GENERATING_NANOCUBE) {
      if (this.SERVER_PID) {
        return { status: 4, message: 'SERVER RUNNING' };
      } else {
        return { status: 0, message: 'GENERATING IN PROGRESS' };
      }
    } else {
      const dataset = await DatasetService.instance.getById(datasetId);

      if (dataset.columns.length > 0) {
        this.GENERATING_NANOCUBE = true;

        try {
          if (!dataset.nanocubeMapPath) {
            this.generateMapFile(dataset);
          } else if (!dataset.nanocubeFilePath) {
            this.generateNanocubeFile(dataset);
          } else {
            this.startServer(dataset);
            return { status: 2, message: 'STARTING SERVER' };
          }
        } catch (error) {
          logger.error(error);
          this.GENERATING_NANOCUBE = false;
        }

        return { status: 1, message: 'START A NEW NANOCUBE' };
      }

      return { status: 3, message: 'INVALID DATASET' };
    }
  }

  private async startServer(dataset: Dataset): Promise<void> {
    const internalNanocubePath = `nanocubes/${dataset.originalname}.nanocube`;
    const nanocubePath = path.join(__dirname, `../../${internalNanocubePath}`);

    const nanocube = spawn('nanocube', ['serve', '51234', `juno=${nanocubePath}`]);

    logger.warn(`PID ${nanocube.pid}`);

    this.SERVER_PID = nanocube.pid;

    nanocube.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });

    nanocube.stderr.on('data', (data) => {
      console.log(`stderr: ${data}`);
    });

    nanocube.on('error', (error) => {
      console.log(`error: ${error.message}`);
    });

    nanocube.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
    });
  }

  private async generateMapFile(dataset: Dataset): Promise<void> {
    logger.info('Start map file');

    const dimensions = dataset.columns.filter((column) => column.type === DatasetColumnType.DIMENSION);

    const mapFile: string[] = [];

    const location = dimensions.filter((column) => ['latitude', 'longitude'].includes(column.name.toLowerCase()));
    if (location.length === 2) {
      mapFile.push(`index_dimension('location',input('${location[0].name}','${location[1].name}'),latlon(25));`);
    }

    const measures = dataset.columns.filter((column) => column.type === DatasetColumnType.MEASURE);

    const fileData = fs.readFileSync(dataset.path, 'utf8');

    const data = datalib.read(fileData, { type: 'csv', parse: 'auto' });
    const stats = datalib.summary(data);

    stats.forEach((stat) => {
      const isDimension = dimensions.find((column) => column.name === stat.field);

      if (isDimension) {
        let b = Math.ceil(Math.log(stat.distinct) / Math.log(2));
        let l = b > 8 ? b % 8 : 1;

        b = Math.min(b, 8);
        l = Math.max(l, 1);

        if (stat.type === 'string') {
          mapFile.push(`index_dimension('${stat.field}',input('${stat.field}'),categorical(${b},${l}));`);
        } else if (stat.type === 'date') {
          // index_dimension('time', input('Updated'), time(16, '2020-01-01T00:00:00-06:00', 3600, 6*60));
          mapFile.push(`index_dimension('time', input('${stat.field}'), time(16, '2020-01-01T00:00:00-06:00', 3600, 6*60));`);
        }
      } else {
        const isMeasure = measures.find((column) => column.name === stat.field);

        if (isMeasure && ['number', 'integer'].includes(stat.type)) {
          mapFile.push(`measure_dimension('${stat.field}',input('${stat.field}'),u32);`);
        }
      }
    });

    mapFile.push(`measure_dimension('count',input(),u32);`);

    const mapContent = mapFile.join('\n');
    const internalPath = `mappings/${dataset.originalname}.map`;

    const mapPath = path.join(__dirname, `../../${internalPath}`);

    fs.writeFileSync(mapPath, mapContent, 'utf8');

    dataset.nanocubeMapPath = internalPath;

    this.entityManager.save(Dataset, dataset);

    logger.info('End map file');

    this.generateNanocubeFile(dataset);
  }

  private async generateNanocubeFile(dataset: Dataset): Promise<void> {
    logger.info('Start nanocube file');

    return new Promise((resolve, reject) => {
      const internalPath = `mappings/${dataset.originalname}.map`;
      const internalNanocubePath = `nanocubes/${dataset.originalname}.nanocube`;

      const csvPath = path.join(__dirname, `../../${dataset.path}`);
      const mapPath = path.join(__dirname, `../../${internalPath}`);
      const nanocubePath = path.join(__dirname, `../../${internalNanocubePath}`);

      const cmd = `nanocube create ${csvPath} ${mapPath} ${nanocubePath} -header`;

      exec(
        cmd,
        {
          env: {
            ...process.env,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            logger.info('Enf nanocube file with error');
            reject();
          }

          console.log('stdout', stdout);
          console.log('stderr', stderr);

          dataset.nanocubeFilePath = internalNanocubePath;
          this.entityManager.save(Dataset, dataset);

          this.GENERATING_NANOCUBE = false;

          logger.info('End nanocube file');

          resolve();
        }
      );
    });
  }
}
