import { DatasetColumnRole } from '@junoapp/common';

export type DatasetColumnRequest = { id: number; name: string; index: number; role: DatasetColumnRole };
