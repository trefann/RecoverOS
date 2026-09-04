import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does NOT catch a rejected promise returned from an async route
 * handler — it becomes an unhandled rejection, and Node's default behavior
 * (since Node 15) is to crash the process. Every async handler in this app
 * must be wrapped in this so failures reach the error-handling middleware
 * in index.ts as a 500 instead of taking the whole server down.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
