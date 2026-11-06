import type { Request, RequestHandler, Response } from "express";
import { HttpError } from "./errors.js";

export const COOKIE = "tb_session";
const USER_ID = /^usr_[0-9A-Z]{26}$/;

/** Loads the userId from the signed cookie into res.locals. Unsigned or tampered cookies yield no user. */
export const loadSession: RequestHandler = (req: Request, res, next) => {
  const v = (req.signedCookies as Record<string, unknown> | undefined)?.[COOKIE];
  if (typeof v === "string" && USER_ID.test(v)) res.locals.userId = v;
  next();
};

export const requireUser: RequestHandler = (_req, res, next) => {
  if (!res.locals.userId) throw new HttpError(401, "UNAUTHENTICATED", "no valid session; POST /api/session first");
  next();
};

export const userOf = (res: Response): string => res.locals.userId as string;

export function issueCookie(res: Response, userId: string, secure: boolean): void {
  res.cookie(COOKIE, userId, { signed: true, httpOnly: true, sameSite: "lax", secure, maxAge: 7 * 24 * 3600 * 1000 });
}
