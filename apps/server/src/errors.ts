import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** Runs fn; any thrown error becomes a 409 INVALID_STATE (trust/rails reject illegal operations by throwing). */
export function conflict<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(409, "INVALID_STATE", e instanceof Error ? e.message : "invalid state");
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: "no such route" });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.code, message: err.message }); return; }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "BAD_REQUEST", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    return;
  }
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    console.error("[server] unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "INTERNAL", message: "internal error" });
  } else {
    res.status(status).json({ error: "BAD_REQUEST", message: "malformed request" });
  }
};
