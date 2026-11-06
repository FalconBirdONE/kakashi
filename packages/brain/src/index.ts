import type { Brain } from "@tollbooth/contracts";
import { createFunctions } from "./functions";

export function createBrain(env: Record<string, string | undefined> = process.env): Brain {
  return createFunctions(env);
}

export { callStructured } from "./client";
export type { CallOpts, ClientDeps } from "./client";
export { postCheckDecisions } from "./functions";
