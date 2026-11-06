import type { Rails } from "@tollbooth/contracts";

export function createRails(_env: Record<string, string | undefined> = process.env): Rails {
  throw new Error("createRails: not implemented");
}
