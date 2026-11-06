import { randomBytes } from "node:crypto";
import { serverEnv } from "@tollbooth/contracts";

export type Config = {
  port: number;
  demoMode: boolean;
  liveDemo?: boolean;
  useReal: ("rails" | "brain" | "trust")[];
  merchantsUrl: string;
  sessionSecret: string;
  secureCookie: boolean;
  authDbPath: string;
  invites: string[];
  login?: import("./auth/routes.js").LoginConfig;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = serverEnv.parse(env);
  let sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    if (env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
    // ponytail: ephemeral secret means sessions reset on restart; set SESSION_SECRET to keep them.
    sessionSecret = randomBytes(32).toString("hex");
    console.warn("[config] SESSION_SECRET not set; using an ephemeral one");
  }
  if (env.NODE_ENV === "production" && sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return {
    authDbPath: env.AUTH_DB_PATH ?? `${env.DB_PATH ?? "./data/tollbooth.sqlite"}.auth`,
    invites: (env.INVITE_EMAILS ?? "").split(",").map(x=>x.trim()).filter(Boolean),
    ...(env.LOGIN_ISSUER && env.LOGIN_CLIENT_ID && env.LOGIN_CLIENT_SECRET && env.LOGIN_REDIRECT_URI ? {login:{issuer:env.LOGIN_ISSUER,clientId:env.LOGIN_CLIENT_ID,clientSecret:env.LOGIN_CLIENT_SECRET,redirectUri:env.LOGIN_REDIRECT_URI}}:{}),
    port: Number(env.PORT ?? 4000),
    demoMode: e.DEMO_MODE,
    liveDemo: env.LIVE_DEMO === "true",
    useReal: e.USE_REAL,
    merchantsUrl: e.MERCHANTS_URL,
    sessionSecret,
    secureCookie: env.NODE_ENV === "production",
  };
}
