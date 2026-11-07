import { addA, subA, type Mandate, type PurchaseState, type RunView } from "@kakashi/contracts";

/** Purchases that hold budget or already spent it; they count toward maxPurchasesPerRun. */
export const ACTIVE_PURCHASE: readonly PurchaseState[] = ["AWAITING_APPROVAL", "RESERVED", "SIGNED", "SUBMITTED", "UNKNOWN", "CONFIRMED"];
export const UNRESOLVED_PURCHASE: readonly PurchaseState[] = ["AWAITING_APPROVAL", "RESERVED", "SIGNED", "SUBMITTED", "UNKNOWN"];

export const budgetLeft = (m: Mandate) => subA(m.totalBudgetAtomic, addA(m.spentAtomic, m.reservedAtomic));
export const countActive = (v: RunView) => v.purchases.filter((p) => ACTIVE_PURCHASE.includes(p.state)).length;

export function planQuery(v: RunView): Record<string, string> {
  const q = v.run.plan?.query;
  return q?.tokenId ? { tokenId: q.tokenId } : {};
}
