import type { Brain } from "@tollbooth/contracts";

export function createBrain(_env: Record<string, string | undefined> = process.env): Brain {
  throw new Error("createBrain: not implemented");
}

export { callStructured } from "./client";
export type { CallOpts, ClientDeps } from "./client";
