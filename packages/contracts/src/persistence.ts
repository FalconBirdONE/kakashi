import type { ResearchRun } from './entities.js';

export type ResourceKind = 'mandate' | 'run' | 'purchase' | 'attempt';
export interface Persistence {
  owner(kind: ResourceKind, id: string): string | null;
  runs(): ResearchRun[];
  reserveInference(runId:string,requestKey:string,maxCost:string,limit:string):void;
}
