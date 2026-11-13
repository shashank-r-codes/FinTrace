import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';

export type UserRole =
  | 'Administrator'
  | 'Senior Investigator'
  | 'Investigator'
  | 'Bank Nodal Officer'
  | 'citizen';

export interface AuthUserPayload {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  institutionId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new AppError('Authentication token missing.', 401, 'UNAUTHORIZED'));
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthUserPayload;
    req.user = decoded;
    next();
  } catch {
    next(new AppError('Invalid or expired access token.', 401, 'TOKEN_INVALID'));
  }
}
