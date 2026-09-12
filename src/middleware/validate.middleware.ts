import { Request, Response, NextFunction } from "express";
import { ZodError, ZodTypeAny } from "zod";
import { AppError } from "../utils/AppError";

interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

const formatZodError = (error: ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");

// Parses req.body/params/query against the given Zod schemas and replaces them with the
// parsed (and coerced/defaulted) result. Throws a 400 AppError on the first validation
// failure so every route gets the same error shape via the existing error middleware.
export const validate = (schemas: ValidationSchemas) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body ?? {});
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params ?? {});
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query ?? {});
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new AppError(formatZodError(error), 400));
        return;
      }
      next(error);
    }
  };
};
