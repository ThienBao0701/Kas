import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors';

/** Any unmatched route becomes a normal ApiError so the shape stays consistent. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Không tìm thấy đường dẫn: ${req.method} ${req.path}`));
}
