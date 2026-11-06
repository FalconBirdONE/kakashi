import { randomBytes } from "node:crypto";
import { serverEnv } from "@tollbooth/contracts";

export type Config = {
  port: number;
  demoMode: boolean;
  useReal: ("rails" | "brain" | "trust")[];
  merchantsUrl: string;
  sessionSecret: string;
  secureCookie: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = serverEnv.parse(env);
  let sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    // ponytail: ephemeral secret means sessions reset on restart; set SESSION_SECRET to keep them.
    sessionSecret = randomBytes(32).toString("hex");
    console.warn("[config] SESSION_SECRET not set; using an ephemeral one");
  }
  return {
    port: Number(env.PORT ?? 4000),
    demoMode: e.DEMO_MODE,
    useReal: e.USE_REAL,
    merchantsUrl: e.MERCHANTS_URL,
    sessionSecret,
    secureCookie: env.NODE_ENV === "production",
  };
}
