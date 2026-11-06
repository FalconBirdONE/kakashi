import type { InferenceTrace } from './entities.js';
export type InferenceAttempt = InferenceTrace & {requestKey:string; billingState:'CONFIRMED'|'UNKNOWN'; ok:boolean; error?:string};
export interface InferenceAccounting {
  reserve(requestKey:string):void;
  record(trace:InferenceAttempt):void;
}
