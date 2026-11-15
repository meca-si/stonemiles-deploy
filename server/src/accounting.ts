// accounting.ts — QuickBooks Online + Xero two-way sync
// (Research Wave 2 item 10). Pure mapping + change/match rules,
// plus the OAuth partner seam; the actions in actions.ts wire
// these to the DB, the chain, and the mail path.
//
// THE SEAM (house style, same as factorPartnerFromEnv /
// parkingPartnerFromEnv): a provider is configured only when its
// OAuth app credentials are in the environment
// (QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET, XERO_CLIENT_ID
// / XERO_CLIENT_SECRET). Production passes no transport and no
// credentials exist yet, so every provider reads UNCONFIGURED:
// the connect panel says "Accounting sync isn't connected yet"
// and nothing pretends to sync. When credentials land, the same
// code runs the real OAuth exchange and API calls — the wire
// shapes below are the providers' documented ones (QuickBooks
// v3 REST, Xero 2.0), isolated inside this module's adapters.
//
// TOKENS: OAuth access/refresh tokens live ONLY in the
// accounting_connections row on the server. No function here logs
// them, no action returns them, and no chain payload carries
// them — the sync seals carry record ids, provider object ids,
// and statuses, never credentials and never new money figures
// (the amounts an invoice seal carries are the invoice's own,
// sealed when the invoice was cut).
//
// SYNC RULES (the money-record discipline):
//  - A sync run is IDEMPOTENT: every outbound record carries a
//    per-record sync row with the provider object id it created;
//    a re-run whose local stamp is unchanged makes NO provider
//    call for that record (test-pinned).
//  - Change detection is stamp-based: the local stamp is a hash
//    of the mapped object; the provider stamp is the provider's
//    own version marker (QuickBooks SyncToken + last-updated,
//    Xero UpdatedDateUTC). Local-only change → push. Provider
//    changed since the last sync (with or without a local
//    change) → CONFLICT: both mapped versions are snapshotted
//    for the review panel and nothing moves until the user
//    picks a winner. Nothing auto-merges a money record.
//  - Inbound payments recorded in the accounting system are
//    matched to local invoices (provider invoice id first, then
//    invoice number) and applied ONLY through the app's existing
//    sealed payment path (recordInvoicePayment +
//    markInvoicePaidRow in actions.ts — no second money path).
//    A payment that matches nothing lands in the review list;
//    it is never force-applied.

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Provider-neutral objects — what the mapping produces and the
// adapters translate. Snapshots of these are what the review
// panel shows, so they carry no credentials and no internals.
// ---------------------------------------------------------------------------

export type AccountingProviderKind = "quickbooks" | "xero";

export const ACCOUNTING_PROVIDERS: { kind: AccountingProviderKind; name: string }[] = [
  { kind: "quickbooks", name: "QuickBooks Online" },
  { kind: "xero", name: "Xero" },
];

export function accountingProviderName(kind: string): string {
  return ACCOUNTING_PROVIDERS.find((p) => p.kind === kind)?.name ?? kind;
}

export interface ProviderLine {
  description: string;
  amount: number;
}

export interface ProviderInvoiceObject {
  docNumber: string;
  customerName: string;
  lines: ProviderLine[];
  amount: number;
  issueDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  status: "issued" | "paid";
  memo: string | null;
}

export interface ProviderBillObject {
  docNumber: string;
  vendorName: string;
  lines: ProviderLine[];
  amount: number;
  periodLabel: string | null;
}

export interface ProviderPaymentObject {
  amount: number;
  paidDate: string; // YYYY-MM-DD
  invoiceDocNumber: string | null;
  providerInvoiceId: string | null;
  memo: string | null;
}

/** A payment that exists in the accounting system, read back for
 *  the inbound leg. `stamp` is the provider's version marker. */
export interface ProviderPaymentSnapshot extends ProviderPaymentObject {
  providerId: string;
  stamp: string;
}

// ---------------------------------------------------------------------------
// Local record shapes the mapping consumes (the actions project
// DB rows into these; the mapping never sees a DB row).
// ---------------------------------------------------------------------------

export interface InvoiceSyncLike {
  id: number;
  number: string;
  status: string; // draft | issued | paid
  billToName: string;
  billToCompany: string | null;
  referenceNumber: string | null;
  lines: { label: string; amount: number }[];
  amount: number;
  issuedAtIso: string | null;
  dueAtIso: string | null;
}

export interface PaymentSyncLike {
  id: number;
  amount: number;
  paidAtIso: string;
  note: string | null;
}

export interface SettlementSyncLike {
  id: number;
  carrier: string | null;
  periodLabel: string | null;
  gross: number | null;
  net: number | null;
  /** Raw lines_json from the settlements row — parsed here,
   *  defensively: an unparseable or shapeless value falls back
   *  to a single net line rather than dropping the record. */
  linesJson: string;
}

const ymd = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);

/** An issued/paid invoice → the provider's invoice object,
 *  field by field. The customer is who the bill was cut to
 *  (company when the invoice names one, else the contact name);
 *  the memo carries the load's reference number, the handle a
 *  human matches on in both systems. */
export function mapInvoiceToProvider(inv: InvoiceSyncLike): ProviderInvoiceObject {
  return {
    docNumber: inv.number,
    customerName: inv.billToCompany?.trim() || inv.billToName,
    lines: inv.lines
      .filter((l) => Number.isFinite(l.amount))
      .map((l) => ({ description: l.label, amount: round2(l.amount) })),
    amount: round2(inv.amount),
    issueDate: ymd(inv.issuedAtIso),
    dueDate: ymd(inv.dueAtIso),
    status: inv.status === "paid" ? "paid" : "issued",
    memo: inv.referenceNumber?.trim() ? inv.referenceNumber.trim() : null,
  };
}

/** A recorded load payment → the provider's payment object,
 *  linked to the invoice it covers (by provider id AND by
 *  invoice number, so either system can be matched by a human). */
export function mapPaymentToProvider(
  pay: PaymentSyncLike,
  link: { providerInvoiceId: string | null; invoiceDocNumber: string },
): ProviderPaymentObject {
  return {
    amount: round2(pay.amount),
    paidDate: ymd(pay.paidAtIso) ?? "",
    invoiceDocNumber: link.invoiceDocNumber,
    providerInvoiceId: link.providerInvoiceId,
    memo: pay.note?.trim() ? pay.note.trim() : null,
  };
}

/** A driver settlement statement → the provider's bill object:
 *  the carrier is the vendor, the statement's net is the bill
 *  total, and the doc number is the settlement's own stable
 *  handle (STL-<id>) so a re-sync finds the same bill. Returns
 *  null when the statement carries no figure at all — there is
 *  nothing honest to sync. */
export function mapSettlementToProvider(s: SettlementSyncLike): ProviderBillObject | null {
  const net = s.net != null && Number.isFinite(s.net) ? round2(s.net) : null;
  const gross = s.gross != null && Number.isFinite(s.gross) ? round2(s.gross) : null;
  const amount = net ?? gross;
  if (amount == null) return null;
  let lines: ProviderLine[] = [];
  try {
    const parsed = JSON.parse(s.linesJson) as unknown;
    if (Array.isArray(parsed)) {
      lines = parsed
        .map((raw) => {
          const r = (raw ?? {}) as { label?: unknown; description?: unknown; amount?: unknown };
          const description =
            typeof r.description === "string" && r.description.trim()
              ? r.description.trim()
              : typeof r.label === "string" && r.label.trim()
                ? r.label.trim()
                : null;
          const amt = typeof r.amount === "number" && Number.isFinite(r.amount) ? round2(r.amount) : null;
          return description && amt != null ? { description, amount: amt } : null;
        })
        .filter((l): l is ProviderLine => l != null);
    }
  } catch {
    lines = [];
  }
  if (lines.length === 0) {
    lines = [{ description: net != null ? "Settlement net" : "Settlement gross", amount }];
  }
  return {
    docNumber: `STL-${s.id}`,
    vendorName: s.carrier?.trim() || "Carrier",
    lines,
    amount,
    periodLabel: s.periodLabel?.trim() ? s.periodLabel.trim() : null,
  };
}

// ---------------------------------------------------------------------------
// Stamps, change classification, payment matching
// ---------------------------------------------------------------------------

/** Canonical JSON: object keys sorted recursively, so two equal
 *  objects always serialize identically regardless of key order. */
export function canonicalJson(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** FNV-1a 64-bit over the canonical form — a deterministic
 *  version stamp for change detection. It is a sync cursor, not
 *  a security hash; the sealed chain is the integrity record. */
export function accountingStampFor(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return `fnv1a:${hash.toString(16).padStart(16, "0")}`;
}

export type SyncChange = "none" | "push" | "conflict";

/** The one classification every outbound record goes through:
 *  - neither side changed since the last sync → none (no call)
 *  - only the local side changed → push
 *  - the provider side changed since the last sync → conflict,
 *    whether or not the local side also changed: the provider
 *    copy no longer matches what we last agreed it was, and a
 *    money record is never silently overwritten or pulled. */
export function classifySyncChange(input: {
  localChanged: boolean;
  providerChanged: boolean;
}): SyncChange {
  if (input.providerChanged) return "conflict";
  if (input.localChanged) return "push";
  return "none";
}

/** Match an inbound provider payment to a local invoice:
 *  the provider invoice id it names first (exact), then the
 *  invoice number. Null when it matches nothing — the caller
 *  parks it in the review list, never force-applies it. */
export function matchProviderPayment(
  payment: ProviderPaymentSnapshot,
  candidates: readonly { invoiceId: number; docNumber: string; providerObjectId: string | null }[],
): number | null {
  if (payment.providerInvoiceId) {
    const byId = candidates.find((c) => c.providerObjectId === payment.providerInvoiceId);
    if (byId) return byId.invoiceId;
  }
  if (payment.invoiceDocNumber) {
    const byDoc = candidates.find((c) => c.docNumber === payment.invoiceDocNumber);
    if (byDoc) return byDoc.invoiceId;
  }
  return null;
}

/** Flatten a provider object into label/value lines for the
 *  review panel — both versions of a conflict render through
 *  this one shape, so the user compares like with like. */
export function accountingSnapshotLines(
  obj: ProviderInvoiceObject | ProviderBillObject | ProviderPaymentSnapshot | null,
): { label: string; value: string }[] {
  if (!obj) return [{ label: "Record", value: "—" }];
  const moneyFmt = (n: number) => `$${n.toFixed(2)}`;
  const lines: { label: string; value: string }[] = [];
  if ("customerName" in obj) {
    lines.push({ label: "Invoice", value: obj.docNumber });
    lines.push({ label: "Customer", value: obj.customerName });
    lines.push({ label: "Status", value: obj.status === "paid" ? "Paid" : "Issued" });
    if (obj.issueDate) lines.push({ label: "Issued", value: obj.issueDate });
    if (obj.dueDate) lines.push({ label: "Due", value: obj.dueDate });
    lines.push({ label: "Amount", value: moneyFmt(obj.amount) });
    for (const l of obj.lines) lines.push({ label: `Line — ${l.description}`, value: moneyFmt(l.amount) });
    if (obj.memo) lines.push({ label: "Memo", value: obj.memo });
    return lines;
  }
  if ("vendorName" in obj) {
    lines.push({ label: "Bill", value: obj.docNumber });
    lines.push({ label: "Vendor", value: obj.vendorName });
    if (obj.periodLabel) lines.push({ label: "Period", value: obj.periodLabel });
    lines.push({ label: "Amount", value: moneyFmt(obj.amount) });
    for (const l of obj.lines) lines.push({ label: `Line — ${l.description}`, value: moneyFmt(l.amount) });
    return lines;
  }
  lines.push({ label: "Payment", value: moneyFmt(obj.amount) });
  lines.push({ label: "Paid on", value: obj.paidDate || "—" });
  if (obj.invoiceDocNumber) lines.push({ label: "For invoice", value: obj.invoiceDocNumber });
  if (obj.memo) lines.push({ label: "Memo", value: obj.memo });
  return lines;
}

// ---------------------------------------------------------------------------
// Partner seam — OAuth + provider adapters behind an injected
// transport, in the factorPartnerFromEnv house style.
// ---------------------------------------------------------------------------

export interface AccountingAccess {
  accessToken: string;
  realmId: string | null;
}

export interface AccountingTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number | null;
  /** QuickBooks names the company in the OAuth callback (realmId);
   *  Xero resolves it from /connections after the exchange. */
  realmId: string | null;
  /** The provider's own name for the company — the "connected
   *  as …" label. Never a token. */
  label: string | null;
}

export interface AccountingPartner {
  kind: AccountingProviderKind;
  name: string;
  authorizeUrl(args: { redirectUri: string; state: string }): string;
  exchangeCode(args: {
    code: string;
    redirectUri: string;
    realmId?: string | null;
  }): Promise<AccountingTokens>;
  upsertInvoice(args: {
    access: AccountingAccess;
    object: ProviderInvoiceObject;
    providerId: string | null;
  }): Promise<{ providerId: string; stamp: string }>;
  fetchInvoice(args: {
    access: AccountingAccess;
    providerId: string;
  }): Promise<{ object: ProviderInvoiceObject; stamp: string } | null>;
  upsertBill(args: {
    access: AccountingAccess;
    object: ProviderBillObject;
    providerId: string | null;
  }): Promise<{ providerId: string; stamp: string }>;
  fetchBill(args: {
    access: AccountingAccess;
    providerId: string;
  }): Promise<{ object: ProviderBillObject; stamp: string } | null>;
  recordPayment(args: {
    access: AccountingAccess;
    object: ProviderPaymentObject;
  }): Promise<{ providerId: string; stamp: string }>;
  fetchPayments(args: {
    access: AccountingAccess;
    sinceIso: string | null;
  }): Promise<ProviderPaymentSnapshot[]>;
}

/** The slice of fetch the adapters use (injectable for tests). */
export type AccountingFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: AccountingFetch = async (url, init) => {
  const r = await fetch(url, init);
  return { ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> };
};

/** Which providers have OAuth app credentials in the env. The
 *  connect panel reads this to say, per provider, whether
 *  connecting is even possible yet. */
export function accountingConfiguredProviders(
  env: Record<string, string | undefined>,
): Record<AccountingProviderKind, boolean> {
  return {
    quickbooks: Boolean(env.QUICKBOOKS_CLIENT_ID?.trim() && env.QUICKBOOKS_CLIENT_SECRET?.trim()),
    xero: Boolean(env.XERO_CLIENT_ID?.trim() && env.XERO_CLIENT_SECRET?.trim()),
  };
}

function basicAuth(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

function formBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// ---- QuickBooks Online adapter -------------------------------------------

function quickbooksPartner(clientId: string, clientSecret: string, fetchFn: AccountingFetch): AccountingPartner {
  const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
  const base = (realmId: string | null) => `https://quickbooks.api.intuit.com/v3/company/${realmId ?? ""}`;
  const headers = (access: AccountingAccess) => ({
    authorization: `Bearer ${access.accessToken}`,
    accept: "application/json",
    "content-type": "application/json",
  });
  async function query(access: AccountingAccess, q: string): Promise<Record<string, unknown>> {
    const r = await fetchFn(`${base(access.realmId)}/query?query=${encodeURIComponent(q)}`, {
      method: "GET",
      headers: headers(access),
    });
    if (!r.ok) throw new Error(`QuickBooks answered ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  }
  async function post(access: AccountingAccess, path: string, body: unknown): Promise<Record<string, unknown>> {
    const r = await fetchFn(`${base(access.realmId)}/${path}`, {
      method: "POST",
      headers: headers(access),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`QuickBooks answered ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  }
  async function get(access: AccountingAccess, path: string): Promise<Record<string, unknown> | null> {
    const r = await fetchFn(`${base(access.realmId)}/${path}`, { method: "GET", headers: headers(access) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`QuickBooks answered ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  }
  /** QuickBooks invoices reference a customer by id: resolve the
   *  mapped customer name to an id, creating the customer when
   *  the books don't have one yet. */
  async function customerIdFor(access: AccountingAccess, name: string): Promise<string> {
    const found = await query(access, `select Id from Customer where DisplayName = '${name.replace(/'/g, "\\'")}'`);
    const rows = (found.QueryResponse as { Customer?: { Id?: string }[] } | undefined)?.Customer ?? [];
    if (rows[0]?.Id) return rows[0].Id;
    const created = await post(access, "customer", { DisplayName: name });
    const cust = (created.Customer ?? created) as { Id?: string };
    if (!cust.Id) throw new Error("QuickBooks accepted the customer call but returned no id");
    return cust.Id;
  }
  const qbStamp = (row: Record<string, unknown>): string => {
    const meta = (row.MetaData ?? {}) as { LastUpdatedTime?: string };
    return `qb:${String(row.SyncToken ?? "0")}:${meta.LastUpdatedTime ?? ""}`;
  };
  const qbInvoiceToObject = (row: Record<string, unknown>): ProviderInvoiceObject => {
    const lineRows = Array.isArray(row.Line) ? (row.Line as Record<string, unknown>[]) : [];
    const lines = lineRows
      .filter((l) => l.DetailType === "SalesItemLineDetail")
      .map((l) => {
        const detail = (l.SalesItemLineDetail ?? {}) as { ItemRef?: { name?: string } };
        return {
          description: typeof l.Description === "string" && l.Description ? l.Description : (detail.ItemRef?.name ?? "Freight"),
          amount: typeof l.Amount === "number" ? l.Amount : 0,
        };
      });
    const custRef = (row.CustomerRef ?? {}) as { name?: string };
    return {
      docNumber: String(row.DocNumber ?? ""),
      customerName: custRef.name ?? "",
      lines,
      amount: typeof row.TotalAmt === "number" ? row.TotalAmt : 0,
      issueDate: typeof row.TxnDate === "string" ? row.TxnDate : null,
      dueDate: typeof row.DueDate === "string" ? row.DueDate : null,
      status: typeof row.Balance === "number" && row.Balance <= 0.005 && typeof row.TotalAmt === "number" && row.TotalAmt > 0 ? "paid" : "issued",
      memo: typeof row.PrivateNote === "string" ? row.PrivateNote : null,
    };
  };
  return {
    kind: "quickbooks",
    name: "QuickBooks Online",
    authorizeUrl({ redirectUri, state }) {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        scope: "com.intuit.quickbooks.accounting",
        redirect_uri: redirectUri,
        state,
      });
      return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
    },
    async exchangeCode({ code, redirectUri, realmId }) {
      const r = await fetchFn(tokenUrl, {
        method: "POST",
        headers: { authorization: basicAuth(clientId, clientSecret), "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: formBody({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      });
      if (!r.ok) throw new Error(`QuickBooks token exchange answered ${r.status}`);
      const out = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!out.access_token) throw new Error("QuickBooks accepted the exchange but returned no access token");
      let label: string | null = null;
      if (realmId) {
        try {
          const info = await get({ accessToken: out.access_token, realmId }, `companyinfo/${realmId}`);
          const ci = (info?.CompanyInfo ?? {}) as { CompanyName?: string };
          label = ci.CompanyName ?? null;
        } catch {
          label = null; // the label is a nicety; the connection stands on the tokens
        }
      }
      return {
        accessToken: out.access_token,
        refreshToken: out.refresh_token ?? null,
        expiresInSec: typeof out.expires_in === "number" ? out.expires_in : null,
        realmId: realmId ?? null,
        label,
      };
    },
    async upsertInvoice({ access, object, providerId }) {
      const customerId = await customerIdFor(access, object.customerName);
      let syncToken: string | undefined;
      if (providerId) {
        const existing = await get(access, `invoice/${providerId}`);
        if (existing) syncToken = String(existing.SyncToken ?? "0");
      }
      const body: Record<string, unknown> = {
        DocNumber: object.docNumber,
        CustomerRef: { value: customerId },
        TxnDate: object.issueDate ?? undefined,
        DueDate: object.dueDate ?? undefined,
        PrivateNote: object.memo ?? undefined,
        Line: object.lines.map((l) => ({
          DetailType: "SalesItemLineDetail",
          Amount: l.amount,
          Description: l.description,
          SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: l.amount },
        })),
      };
      if (providerId) {
        body.Id = providerId;
        body.SyncToken = syncToken ?? "0";
        body.sparse = false;
      }
      const out = await post(access, "invoice", body);
      const row = (out.Invoice ?? out) as Record<string, unknown>;
      if (!row.Id) throw new Error("QuickBooks accepted the invoice but returned no id");
      return { providerId: String(row.Id), stamp: qbStamp(row) };
    },
    async fetchInvoice({ access, providerId }) {
      const row = await get(access, `invoice/${providerId}`);
      if (!row) return null;
      return { object: qbInvoiceToObject(row), stamp: qbStamp(row) };
    },
    async upsertBill({ access, object, providerId }) {
      let syncToken: string | undefined;
      if (providerId) {
        const existing = await get(access, `bill/${providerId}`);
        if (existing) syncToken = String(existing.SyncToken ?? "0");
      }
      const body: Record<string, unknown> = {
        DocNumber: object.docNumber,
        VendorRef: { value: object.vendorName },
        PrivateNote: object.periodLabel ?? undefined,
        Line: object.lines.map((l) => ({
          DetailType: "AccountBasedExpenseLineDetail",
          Amount: l.amount,
          Description: l.description,
          AccountBasedExpenseLineDetail: { AccountRef: { value: "1" } },
        })),
      };
      if (providerId) {
        body.Id = providerId;
        body.SyncToken = syncToken ?? "0";
      }
      const out = await post(access, "bill", body);
      const row = (out.Bill ?? out) as Record<string, unknown>;
      if (!row.Id) throw new Error("QuickBooks accepted the bill but returned no id");
      return { providerId: String(row.Id), stamp: qbStamp(row) };
    },
    async fetchBill({ access, providerId }) {
      const row = await get(access, `bill/${providerId}`);
      if (!row) return null;
      const lineRows = Array.isArray(row.Line) ? (row.Line as Record<string, unknown>[]) : [];
      const vendorRef = (row.VendorRef ?? {}) as { name?: string };
      return {
        object: {
          docNumber: String(row.DocNumber ?? ""),
          vendorName: vendorRef.name ?? "",
          lines: lineRows.map((l) => ({
            description: typeof l.Description === "string" ? l.Description : "Expense",
            amount: typeof l.Amount === "number" ? l.Amount : 0,
          })),
          amount: typeof row.TotalAmt === "number" ? row.TotalAmt : 0,
          periodLabel: typeof row.PrivateNote === "string" ? row.PrivateNote : null,
        },
        stamp: qbStamp(row),
      };
    },
    async recordPayment({ access, object }) {
      const body: Record<string, unknown> = {
        TotalAmt: object.amount,
        TxnDate: object.paidDate || undefined,
        PrivateNote: object.memo ?? undefined,
        Line: object.providerInvoiceId
          ? [{ Amount: object.amount, LinkedTxn: [{ TxnId: object.providerInvoiceId, TxnType: "Invoice" }] }]
          : [],
      };
      const out = await post(access, "payment", body);
      const row = (out.Payment ?? out) as Record<string, unknown>;
      if (!row.Id) throw new Error("QuickBooks accepted the payment but returned no id");
      return { providerId: String(row.Id), stamp: qbStamp(row) };
    },
    async fetchPayments({ access, sinceIso }) {
      const found = await query(access, "select * from Payment");
      const rows = (found.QueryResponse as { Payment?: Record<string, unknown>[] } | undefined)?.Payment ?? [];
      const out: ProviderPaymentSnapshot[] = [];
      for (const row of rows) {
        const meta = (row.MetaData ?? {}) as { CreateTime?: string; LastUpdatedTime?: string };
        const created = meta.CreateTime ?? "";
        if (sinceIso && created && created < sinceIso) continue;
        const lineRows = Array.isArray(row.Line) ? (row.Line as Record<string, unknown>[]) : [];
        const linked = lineRows.flatMap((l) => (Array.isArray(l.LinkedTxn) ? (l.LinkedTxn as { TxnId?: string; TxnType?: string }[]) : []));
        const invLink = linked.find((t) => t.TxnType === "Invoice");
        out.push({
          providerId: String(row.Id ?? ""),
          amount: typeof row.TotalAmt === "number" ? row.TotalAmt : 0,
          paidDate: typeof row.TxnDate === "string" ? row.TxnDate : "",
          invoiceDocNumber: null, // QuickBooks payments link by id, not by doc number
          providerInvoiceId: invLink?.TxnId ?? null,
          memo: typeof row.PrivateNote === "string" ? row.PrivateNote : null,
          stamp: qbStamp(row),
        });
      }
      return out.filter((p) => p.providerId !== "");
    },
  };
}

// ---- Xero adapter ----------------------------------------------------------

function xeroPartner(clientId: string, clientSecret: string, fetchFn: AccountingFetch): AccountingPartner {
  const apiBase = "https://api.xero.com/api.xro/2.0";
  const headers = (access: AccountingAccess) => ({
    authorization: `Bearer ${access.accessToken}`,
    "xero-tenant-id": access.realmId ?? "",
    accept: "application/json",
    "content-type": "application/json",
  });
  async function call(
    access: AccountingAccess,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Record<string, unknown> | null> {
    const r = await fetchFn(`${apiBase}/${path}`, {
      method,
      headers: { ...headers(access), ...(extraHeaders ?? {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Xero answered ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  }
  const xeroStamp = (row: Record<string, unknown>): string => `xero:${String(row.UpdatedDateUTC ?? "")}`;
  const xeroInvoiceToObject = (row: Record<string, unknown>): ProviderInvoiceObject => {
    const contact = (row.Contact ?? {}) as { Name?: string };
    const lineRows = Array.isArray(row.LineItems) ? (row.LineItems as Record<string, unknown>[]) : [];
    return {
      docNumber: String(row.InvoiceNumber ?? ""),
      customerName: contact.Name ?? "",
      lines: lineRows.map((l) => ({
        description: typeof l.Description === "string" ? l.Description : "Freight",
        amount: typeof l.LineAmount === "number" ? l.LineAmount : 0,
      })),
      amount: typeof row.Total === "number" ? row.Total : 0,
      issueDate: typeof row.Date === "string" ? row.Date.slice(0, 10) : null,
      dueDate: typeof row.DueDate === "string" ? row.DueDate.slice(0, 10) : null,
      status: row.Status === "PAID" ? "paid" : "issued",
      memo: typeof row.Reference === "string" ? row.Reference : null,
    };
  };
  return {
    kind: "xero",
    name: "Xero",
    authorizeUrl({ redirectUri, state }) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "accounting.transactions accounting.contacts",
        state,
      });
      return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
    },
    async exchangeCode({ code, redirectUri }) {
      const r = await fetchFn("https://identity.xero.com/connect/token", {
        method: "POST",
        headers: { authorization: basicAuth(clientId, clientSecret), "content-type": "application/x-www-form-urlencoded" },
        body: formBody({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      });
      if (!r.ok) throw new Error(`Xero token exchange answered ${r.status}`);
      const out = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!out.access_token) throw new Error("Xero accepted the exchange but returned no access token");
      // The tenant (the books this token speaks for) resolves from
      // /connections — its id is the realm every later call names.
      let realmId: string | null = null;
      let label: string | null = null;
      try {
        const cr = await fetchFn("https://api.xero.com/connections", {
          method: "GET",
          headers: { authorization: `Bearer ${out.access_token}`, accept: "application/json" },
        });
        if (cr.ok) {
          const conns = (await cr.json()) as { tenantId?: string; tenantName?: string }[];
          if (Array.isArray(conns) && conns[0]) {
            realmId = conns[0].tenantId ?? null;
            label = conns[0].tenantName ?? null;
          }
        }
      } catch {
        /* label/tenant resolve again on the next call if needed */
      }
      return {
        accessToken: out.access_token,
        refreshToken: out.refresh_token ?? null,
        expiresInSec: typeof out.expires_in === "number" ? out.expires_in : null,
        realmId,
        label,
      };
    },
    async upsertInvoice({ access, object, providerId }) {
      const body = {
        Invoices: [
          {
            Type: "ACCREC",
            Contact: { Name: object.customerName },
            Date: object.issueDate ?? undefined,
            DueDate: object.dueDate ?? undefined,
            InvoiceNumber: object.docNumber,
            Reference: object.memo ?? undefined,
            Status: object.status === "paid" ? "PAID" : "AUTHORISED",
            LineItems: object.lines.map((l) => ({ Description: l.description, LineAmount: l.amount, Quantity: 1, UnitAmount: l.amount })),
            ...(providerId ? { InvoiceID: providerId } : {}),
          },
        ],
      };
      const out = await call(access, "POST", "Invoices", body);
      const row = ((out?.Invoices as Record<string, unknown>[] | undefined) ?? [])[0];
      if (!row?.InvoiceID) throw new Error("Xero accepted the invoice but returned no id");
      return { providerId: String(row.InvoiceID), stamp: xeroStamp(row) };
    },
    async fetchInvoice({ access, providerId }) {
      const out = await call(access, "GET", `Invoices/${providerId}`);
      const row = ((out?.Invoices as Record<string, unknown>[] | undefined) ?? [])[0];
      if (!row) return null;
      return { object: xeroInvoiceToObject(row), stamp: xeroStamp(row) };
    },
    async upsertBill({ access, object, providerId }) {
      const body = {
        Invoices: [
          {
            Type: "ACCPAY",
            Contact: { Name: object.vendorName },
            InvoiceNumber: object.docNumber,
            Reference: object.periodLabel ?? undefined,
            Status: "AUTHORISED",
            LineItems: object.lines.map((l) => ({ Description: l.description, LineAmount: l.amount, Quantity: 1, UnitAmount: l.amount })),
            ...(providerId ? { InvoiceID: providerId } : {}),
          },
        ],
      };
      const out = await call(access, "POST", "Invoices", body);
      const row = ((out?.Invoices as Record<string, unknown>[] | undefined) ?? [])[0];
      if (!row?.InvoiceID) throw new Error("Xero accepted the bill but returned no id");
      return { providerId: String(row.InvoiceID), stamp: xeroStamp(row) };
    },
    async fetchBill({ access, providerId }) {
      const out = await call(access, "GET", `Invoices/${providerId}`);
      const row = ((out?.Invoices as Record<string, unknown>[] | undefined) ?? [])[0];
      if (!row) return null;
      const contact = (row.Contact ?? {}) as { Name?: string };
      const lineRows = Array.isArray(row.LineItems) ? (row.LineItems as Record<string, unknown>[]) : [];
      return {
        object: {
          docNumber: String(row.InvoiceNumber ?? ""),
          vendorName: contact.Name ?? "",
          lines: lineRows.map((l) => ({
            description: typeof l.Description === "string" ? l.Description : "Expense",
            amount: typeof l.LineAmount === "number" ? l.LineAmount : 0,
          })),
          amount: typeof row.Total === "number" ? row.Total : 0,
          periodLabel: typeof row.Reference === "string" ? row.Reference : null,
        },
        stamp: xeroStamp(row),
      };
    },
    async recordPayment({ access, object }) {
      if (!object.providerInvoiceId) throw new Error("Xero payments must name the invoice they pay");
      const body = {
        Payments: [
          {
            Invoice: { InvoiceID: object.providerInvoiceId },
            Account: { Code: "090" },
            Date: object.paidDate || undefined,
            Amount: object.amount,
            Reference: object.memo ?? undefined,
          },
        ],
      };
      const out = await call(access, "POST", "Payments", body);
      const row = ((out?.Payments as Record<string, unknown>[] | undefined) ?? [])[0];
      if (!row?.PaymentID) throw new Error("Xero accepted the payment but returned no id");
      return { providerId: String(row.PaymentID), stamp: xeroStamp(row) };
    },
    async fetchPayments({ access, sinceIso }) {
      const extra = sinceIso ? { "If-Modified-Since": new Date(sinceIso).toUTCString() } : undefined;
      const out = await call(access, "GET", "Payments", undefined, extra);
      const rows = (out?.Payments as Record<string, unknown>[] | undefined) ?? [];
      return rows
        .map((row): ProviderPaymentSnapshot => {
          const inv = (row.Invoice ?? {}) as { InvoiceID?: string; InvoiceNumber?: string };
          return {
            providerId: String(row.PaymentID ?? ""),
            amount: typeof row.Amount === "number" ? row.Amount : 0,
            paidDate: typeof row.Date === "string" ? row.Date.slice(0, 10) : "",
            invoiceDocNumber: inv.InvoiceNumber ?? null,
            providerInvoiceId: inv.InvoiceID ?? null,
            memo: typeof row.Reference === "string" ? row.Reference : null,
            stamp: xeroStamp(row),
          };
        })
        .filter((p) => p.providerId !== "");
    },
  };
}

/**
 * The accounting partner for one provider, when its OAuth app
 * credentials are configured. Returns null when unconfigured:
 * the caller then says "Accounting sync isn't connected yet",
 * plainly, and syncs nothing. A transport may be injected for
 * tests; production passes none.
 */
export function accountingPartnerFromEnv(
  env: Record<string, string | undefined>,
  kind: AccountingProviderKind,
  transport?: AccountingFetch,
): AccountingPartner | null {
  const fetchFn = transport ?? defaultFetch;
  if (kind === "quickbooks") {
    const id = env.QUICKBOOKS_CLIENT_ID?.trim();
    const secret = env.QUICKBOOKS_CLIENT_SECRET?.trim();
    if (!id || !secret) return null;
    return quickbooksPartner(id, secret, fetchFn);
  }
  const id = env.XERO_CLIENT_ID?.trim();
  const secret = env.XERO_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  return xeroPartner(id, secret, fetchFn);
}

/** Where a provider sends the user back after consent. The host
 *  callback route hands the code to completeAccountingConnect;
 *  the path is fixed here so the panel, the action, and the
 *  provider app registration all name the same door. */
export const ACCOUNTING_REDIRECT_URI = "https://app.stonervision.io/accounting/callback";
