import type { Brain } from "@kakashi/contracts";
import { createFunctions } from "./functions.js";

export function createBrain(env: Record<string, string | undefined> = process.env): Brain {
  return createFunctions(env);
}

export { callStructured } from "./client.js";
export type { CallOpts, ClientDeps } from "./client.js";
export { postCheckDecisions } from "./functions.js";
