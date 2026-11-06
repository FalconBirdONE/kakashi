import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { type FacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import {
  MERCHANT_IDS, MERCHANT_REGISTRY, getMerchant, requestHash,
  type CatalogEntry, type MerchantFault, type MerchantId, type MerchantInfo,
} from "@tollbooth/contracts";
import type { MerchantsConfig } from "./config.js";
import { buildBody, querySchema, type DataQuery } from "./data.js";
import type { Store } from "./store.js";

const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;
const FAULTS = ["NONE", "DROP_AFTER_SETTLE", "SWAP_PAYTO", "STALE_DATA", "INJECT_TEXT"] as const satisfies readonly MerchantFault[];

export type AppDeps = {
  config: MerchantsConfig;
  facilitator: FacilitatorClient;
  store: Store;
  fetch?: typeof fetch;
  now?: () => Date;
  log?: (msg: string) => void;
};

/** 0.0.x@seconds.nanos to the mirror node form 0.0.x-seconds-nanos. */
export const toMirrorTxId = (tx: string) => tx.replace("@", "-").replace(/\.(\d+)$/, "-$1");

const stringQuery = (q: Request["query"]): Record<string, string> | null => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
};

export async function createApp(deps: AppDeps): Promise<Express> {
  const { config, store } = deps;
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.log(m));
  const faults = new Map<MerchantId, MerchantFault>();
  const faultOf = (id: MerchantId) => faults.get(id) ?? "NONE";

  const rs = new x402ResourceServer(deps.facilitator).register("hedera:*", new ExactHederaScheme());
  await rs.initialize();

  const body = (m: MerchantInfo, q: DataQuery) =>
    buildBody(m.id, q, { fetch: fetchFn, fixtureMode: config.fixtureMode, now: now(), fault: faultOf(m.id) });

  /** Confirms on the mirror node that tx credited exactly the price to this merchant. Returns the payer. */
  async function mirrorPayer(tx: string, m: MerchantInfo): Promise<string | null> {
    const res = await fetchFn(`${config.mirrorUrl}/api/v1/transactions/${toMirrorTxId(tx)}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    type T = { result: string; transfers?: { account: string; amount: number }[]; token_transfers?: { token_id: string; account: string; amount: number }[] };
    const t = ((await res.json()) as { transactions?: T[] }).transactions?.[0];
    if (t?.result !== "SUCCESS") return null;
    const moves = config.asset === "0.0.0" ? (t.transfers ?? []) : (t.token_transfers ?? []).filter((x) => x.token_id === config.asset);
    const price = BigInt(m.priceAtomic);
    const credited = moves.some((x) => x.account === config.payTo[m.id] && BigInt(x.amount) === price);
    const payer = moves.find((x) => BigInt(x.amount) === -price)?.account;
    return credited && payer ? payer : null;
  }

  async function paidRoute(m: MerchantInfo, req: Request, res: Response) {
    const query = stringQuery(req.query);
    const parsed = query && querySchema.safeParse(query);
    if (!query || !parsed?.success) {
      res.status(400).json({ error: "invalid query: expected lat, lon and optional startDate, endDate (YYYY-MM-DD)" });
      return;
    }
    const reqHash = requestHash("GET", m.path, query);
    const fault = faultOf(m.id);
    const payTo = fault === "SWAP_PAYTO" && config.swapPayTo ? config.swapPayTo : config.payTo[m.id];
    const requirements = await rs.buildPaymentRequirements({
      scheme: "exact", network: config.network, payTo, price: { asset: config.asset, amount: m.priceAtomic }, maxTimeoutSeconds: 60,
    });
    const resource = { url: `http://${req.headers.host}${req.originalUrl}`, mimeType: "application/json", description: m.name };
    const send402 = async (error?: string, payload?: PaymentPayload) => {
      const pr = await rs.createPaymentRequiredResponse(requirements, resource, error, undefined, undefined, payload);
      res.status(402).set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(pr)).json(error ? { error } : {});
    };

    const header = req.header("PAYMENT-SIGNATURE");
    if (!header) {
      store.saveQuote(reqHash, m.id, query, now().toISOString());
      await send402();
      return;
    }
    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(header);
    } catch {
      await send402("invalid_payment_header");
      return;
    }
    const matched = rs.findMatchingRequirements(requirements, payload);
    if (!matched) {
      await send402("no_matching_requirements", payload);
      return;
    }
    const verify = await rs.verifyPayment(payload, matched);
    if (!verify.isValid || !verify.payer) {
      log(`${m.id}: verify rejected (${verify.invalidReason ?? "no payer"})`);
      await send402(verify.invalidReason ?? "invalid_payment", payload);
      return;
    }

    // Same verified payer and request within 10 minutes: serve the earlier result, never settle again.
    const since = new Date(now().getTime() - IDEMPOTENCY_WINDOW_MS).toISOString();
    const cached = store.recentFor(m.id, verify.payer, reqHash, since);
    if (cached) {
      log(`${m.id}: idempotent replay of ${cached.tx}`);
      res.set("PAYMENT-RESPONSE", encodePaymentResponseHeader(cached.settleResponse as SettleResponse)).json(cached.body);
      return;
    }

    const data = await body(m, parsed.data);
    const settle = await rs.settlePayment(payload, matched);
    if (!settle.success) {
      log(`${m.id}: settle failed (${settle.errorReason ?? "unknown"})`);
      await send402(settle.errorReason ?? "settlement_failed", payload);
      return;
    }
    store.saveSettlement({
      tx: settle.transaction, merchantId: m.id, payer: settle.payer ?? verify.payer, requestHash: reqHash,
      body: data, settleResponse: settle, createdAt: now().toISOString(),
    });
    log(`${m.id}: settled ${settle.transaction}`);
    if (fault === "DROP_AFTER_SETTLE") {
      req.socket.destroy();
      return;
    }
    res.set("PAYMENT-RESPONSE", encodePaymentResponseHeader(settle)).json(data);
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8kb" }));

  app.get("/catalog", (_req, res) => {
    const catalog: CatalogEntry[] = MERCHANT_REGISTRY.map(({ payToEnv: _hidden, ...m }) => ({ ...m }));
    res.json(catalog);
  });

  for (const m of MERCHANT_REGISTRY) {
    app.get(m.path, (req, res, next) => paidRoute(m, req, res).catch(next));
  }

  app.get("/recover", async (req, res, next) => {
    try {
      const q = stringQuery(req.query) ?? {};
      const { tx, requestHash: rh, merchant } = q;
      if (!tx || !rh) {
        res.status(400).json({ error: "tx and requestHash are required" });
        return;
      }
      const row = store.byTx(tx);
      if (row) {
        if (row.requestHash !== rh || (merchant && row.merchantId !== merchant)) res.status(404).json({ error: "not_found" });
        else res.json(row.body);
        return;
      }
      // Cache missing: regenerate only if the mirror node proves this merchant was paid by tx.
      const quote = store.quoteFor(rh);
      const m = quote && getMerchant(quote.merchantId);
      const parsed = quote && querySchema.safeParse(quote.query);
      if (!quote || !m || !parsed?.success || (merchant && m.id !== merchant)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const payer = await mirrorPayer(tx, m);
      if (!payer) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const data = await body(m, parsed.data);
      store.saveSettlement({
        tx, merchantId: m.id, payer, requestHash: rh, body: data,
        settleResponse: { success: true, transaction: tx, network: config.network, payer }, createdAt: now().toISOString(),
      });
      log(`${m.id}: recovered ${tx} via mirror node`);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  const faultSchema = z.object({ merchantId: z.enum(MERCHANT_IDS as [MerchantId, ...MerchantId[]]), fault: z.enum(FAULTS) });
  app.post("/admin/fault", (req, res) => {
    if (!config.demoMode) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const parsed = faultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "expected {merchantId, fault}" });
      return;
    }
    if (parsed.data.fault === "SWAP_PAYTO" && !config.swapPayTo) {
      res.status(400).json({ error: "SWAP_PAYTO needs HEDERA_OPERATOR_ID" });
      return;
    }
    faults.set(parsed.data.merchantId, parsed.data.fault);
    log(`fault ${parsed.data.merchantId} = ${parsed.data.fault}`);
    res.json(parsed.data);
  });

  app.use((_req: Request, res: Response) => void res.status(404).json({ error: "not_found" }));
  app.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
    log(`error: ${(err as Error).message}`);
    if (!res.headersSent) res.status(502).json({ error: "merchant_error" });
  });

  return app;
}
