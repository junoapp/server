import { DatasetColumnRole } from '../entity/DatasetColumn';

export type DatasetColumnRequest = { id: number; name: string; index: number; role: DatasetColumnRole };
