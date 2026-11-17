import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error that is safe to show the caller: fixed code + short message, never internal details. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string = code,
  ) {
    super(message);
  }
}

export const errorBody = (code: string, message: string) => ({ error: { code, message } });

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
  if (err instanceof HTTPException) {
    const status = err.status;
    return c.json(errorBody(status === 413 ? "payload_too_large" : "bad_request", "Request rejected"), status);
  }
  // Log only the route and error class: messages can carry user data.
  console.log(JSON.stringify({ level: "error", route: c.req.routePath, kind: err.name }));
  return c.json(errorBody("internal", "Something went wrong"), 500);
}

export const notFound = (c: Context) => c.json(errorBody("not_found", "No such route"), 404);
