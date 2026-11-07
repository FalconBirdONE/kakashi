import { describe, expect, it } from "vitest";
import { MERCHANT_REGISTRY, createFakeBrain } from "@kakashi/contracts";
import { cases, isAccepted, quotes } from "./cases";

describe("eval cases", () => {
  it("only accept normal merchants", () => {
    const normal = MERCHANT_REGISTRY.filter((m) => m.demoRole === "normal").map((m) => m.id);
    for (const id of cases.flatMap((c) => c.accepted.flat())) expect(normal).toContain(id);
  });

  it("a cheapest-first rule passes at most 3 of 6, so removing the AI is noticeable", async () => {
    const brain = createFakeBrain();
    let passed = 0;
    for (const c of cases) {
      const r = await brain.decide({
        question: c.question, needs: [{ needId: "n1", description: "token risk", priority: 1 }], quotes,
        alreadyBought: [], budgetRemainingAtomic: c.budgetAtomic, purchasesRemaining: 3, round: 1,
      });
      if (!r.ok) throw new Error(r.error);
      const buys = r.value.decisions.filter((d) => d.action === "BUY")
        .map((d) => quotes.find((q) => q.quoteId === d.quoteId)!.merchantId);
      if (isAccepted(buys, c)) passed++;
    }
    expect(passed).toBeLessThanOrEqual(3);
  });
});
