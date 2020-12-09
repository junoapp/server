import { DatasetColumnRole } from '../entity/DatasetColumn';

export type DatasetColumnRequest = { name: string; index: number; role: DatasetColumnRole };
