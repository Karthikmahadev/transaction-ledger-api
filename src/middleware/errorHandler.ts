import { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../errors/AppError';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.path} does not exist`, details: null },
  });
};

/** Single place that turns any thrown error into the standard error envelope. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? null },
    });
    return;
  }
  // body-parser errors (malformed JSON, payload too large)
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', details: null },
    });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', details: null },
    });
    return;
  }
  console.error(err); // real cause is logged, never leaked to the client
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', details: null },
  });
};
