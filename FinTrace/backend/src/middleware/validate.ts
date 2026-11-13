import { NextFunction, Request, Response } from 'express';
import { AnyZodObject, ZodSchema } from 'zod';

interface ValidationSchemas {
  body?: ZodSchema;
  query?: AnyZodObject;
  params?: AnyZodObject;
}

export interface ValidatedRequest<
  TBody = unknown,
  TQuery = Record<string, unknown>,
  TParams = Record<string, string>,
> extends Request {
  validatedBody?: TBody;
  validatedQuery?: TQuery;
  validatedParams?: TParams;
}

export function validate(schemas: ValidationSchemas) {
  return (req: ValidatedRequest, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.validatedParams = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        req.validatedQuery = schemas.query.parse(req.query);
      }
      if (schemas.body) {
        const parsedBody = schemas.body.parse(req.body);
        req.body = parsedBody;
        req.validatedBody = parsedBody;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
