import { DatasetColumnType } from '../entity/DatasetColumn';

export type DatasetColumnRequest = { name: string; index: number; type: DatasetColumnType };
