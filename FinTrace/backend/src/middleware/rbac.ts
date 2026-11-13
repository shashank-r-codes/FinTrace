import { NextFunction, Request, Response } from 'express';
import { UserRole } from './auth.js';
import { AppError } from './errorHandler.js';

export const OFFICER_ROLES: UserRole[] = [
  'Administrator',
  'Senior Investigator',
  'Investigator',
  'Bank Nodal Officer',
];

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

export const authorizeOfficer = authorizeRoles(...OFFICER_ROLES);
