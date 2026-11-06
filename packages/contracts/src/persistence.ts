import type { ResearchRun } from './entities.js';

export type ResourceKind = 'mandate' | 'run' | 'purchase' | 'attempt';
export interface Persistence {
  owner(kind: ResourceKind, id: string): string | null;
  runs(): ResearchRun[];
  permit(purchaseId:string):import('./permit.js').SigningPermit|null;
  evidence(purchaseId:string):unknown;
  saveEvidence(purchaseId:string,data:unknown):void;
  audit(purchaseId:string):{state:'PENDING'|'ANCHORED'|'UNKNOWN';topicId?:string;sequenceNumber?:number};
  pendingAttempts():{id:string;purpose:string;targetId:string;expiresAt:string}[];
  recoveryPurchases():import('./entities.js').Purchase[];
  resumeKey(runId:string,key:string,complete?:boolean):boolean;
  reserveInference(runId:string,requestKey:string,maxCost:string,limit:string):void;
}
