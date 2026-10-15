import { AppError } from '../lib/errors.js';

/** Validate + replace req.body with the parsed (trimmed/typed) value. */
export const validateBody = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return next(
      new AppError('VALIDATION_ERROR', 'Request validation failed.', {
        status: 400,
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    );
  }
  req.body = parsed.data;
  next();
};
