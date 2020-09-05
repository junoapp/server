import { Request, Response } from 'express';

export interface Router {
  path: string;
  method: string;
  action: (request: Request, response: Response) => Promise<void>;
  middleware?: Function;
}
