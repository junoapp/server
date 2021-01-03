import { Request, Response } from 'express';

export interface Router {
  path: string;
  method: 'post' | 'get' | 'put' | 'delete';
  action: (request: Request, response: Response) => Promise<void>;
  middleware?: any;
}
