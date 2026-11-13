import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

interface PgError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, 'ROUTE_NOT_FOUND'));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten(),
      },
    });
    return;
  }

  const pgErr = err as PgError;
  if (pgErr?.code === '23505') {
    res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_RESOURCE',
        message: pgErr.detail ?? 'A record with these unique attributes already exists.',
        details: { constraint: pgErr.constraint ?? null },
      },
    });
    return;
  }

  if (pgErr?.code === '23503') {
    res.status(400).json({
      success: false,
      error: {
        code: 'FOREIGN_KEY_VIOLATION',
        message: pgErr.detail ?? 'Referenced resource does not exist.',
        details: { constraint: pgErr.constraint ?? null },
      },
    });
    return;
  }

  if (pgErr?.code === '23514' || pgErr?.code === '22P02') {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_DATA_CONSTRAINT',
        message: pgErr.detail ?? pgErr.message ?? 'Invalid input format or constraint.',
      },
    });
    return;
  }

  logger.error({ err, method: req.method, path: req.originalUrl }, 'Unhandled server error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred.',
    },
  });
}
