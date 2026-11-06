import {
  createFakeBrain, createFakeRails, createFakeTrust,
  type Brain, type FakeBrain, type FakeRails, type FakeTrust, type Rails, type Trust,
} from "@tollbooth/contracts";

type Name = "rails" | "brain" | "trust";

export type Deps = {
  rails: Rails;
  brain: Brain;
  trust: Trust;
  /** Present only for the parts running on fakes; used by demo and dev routes. */
  fakes: { rails?: FakeRails; brain?: FakeBrain; trust?: FakeTrust };
  modes: Record<Name, "fake" | "real">;
};

/** Picks the real factory for each name in useReal, the fake otherwise. Logs modes only. */
export async function createDeps(
  useReal: readonly Name[],
  env: NodeJS.ProcessEnv = process.env,
  log: (m: string) => void = console.log,
): Promise<Deps> {
  const real = new Set(useReal);
  const deps = { fakes: {}, modes: { rails: "fake", brain: "fake", trust: "fake" } } as Deps;

  if (real.has("rails")) { deps.rails = (await import("@tollbooth/rails")).createRails(env); deps.modes.rails = "real"; }
  else { deps.rails = deps.fakes.rails = createFakeRails(); }

  if (real.has("brain")) { deps.brain = (await import("@tollbooth/brain")).createBrain(env); deps.modes.brain = "real"; }
  else { deps.brain = deps.fakes.brain = createFakeBrain(); }

  if (real.has("trust")) { deps.trust = (await import("@tollbooth/trust")).createTrust(env); deps.modes.trust = "real"; }
  else { deps.trust = deps.fakes.trust = createFakeTrust(); }

  log(`[wiring] rails=${deps.modes.rails} brain=${deps.modes.brain} trust=${deps.modes.trust}`);
  return deps;
}
