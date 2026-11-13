import { NextFunction, Request, Response } from 'express';
import { UserRole } from './auth.js';
import { AppError } from './errorHandler.js';

export function authorizeRoles(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError('Authentication required.', 401, 'UNAUTHORIZED'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(
        new AppError(
          `Access denied for role '${req.user.role}'. Required: ${allowedRoles.join(', ')}.`,
          403,
          'FORBIDDEN'
        )
      );
      return;
    }

    next();
  };
}
