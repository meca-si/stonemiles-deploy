/**
 * Stripe Checkout (hosted page) — no Stripe SDK.
 *
 * Used by the dispatch-fee debit rail: RUGGS LOGISTICS DISPATCH SUPPORT opens a Checkout
 * Session for an invoice's exact fee amount and the carrier pays on
 * Stripe's hosted page. This module is the portable half: the pure
 * session-params builder, the form encoder, and the typed errors.
 * The host half — reading STRIPE_SECRET_KEY from the server
 * environment and calling the Stripe API with it — lives in
 * server/src/privileged.ts behind declared contracts, because the
 * action bundle may not read the host environment. Until the key is
 * configured, the transport reports notConfigured and the invoice
 * keeps stating the rail is "being set up".
 */

export type CheckoutSessionParamsInput = {
  amountCents: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  destination?: string | null;
  applicationFeeAmountCents?: number | null;
};

export type StripeCheckoutParams = {
  ui_mode: "hosted_page";
  mode: "payment";
  billing_address_collection: "auto";
  phone_number_collection: { enabled: boolean };
  automatic_tax: { enabled: boolean };
  allow_promotion_codes: boolean;
  submit_type: "auto";
  integration_identifier: "hosted_mobile_app_0001";
  origin_context: "mobile_app";
  success_url: string;
  cancel_url: string;
  line_items: {
    quantity: number;
    price_data: {
      currency: "usd";
      unit_amount: number;
      product_data: { name: string };
    };
  }[];
  metadata?: Record<string, string>;
  payment_intent_data?: {
    transfer_data: { destination: string };
    application_fee_amount?: number;
  };
};

/**
 * Build the Checkout Session params for a one-time payment. Pure.
 * The fixed_by_ui values come from the Checkout Studio configuration
 * verbatim. The amount rides inline price_data BY DESIGN: dispatch
 * fees vary per load, so there is no fixed Stripe Price ID.
 * payment_method_collection is intentionally absent — Studio Rule 8:
 * it applies to subscription mode only, and this is payment mode.
 */
export function buildCheckoutSessionParams(input: CheckoutSessionParamsInput): StripeCheckoutParams {
  const params: StripeCheckoutParams = {
    ui_mode: "hosted_page",
    mode: "payment",
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    submit_type: "auto",
    integration_identifier: "hosted_mobile_app_0001",
    origin_context: "mobile_app",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.amountCents,
          product_data: { name: input.productName },
        },
      },
    ],
  };
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    params.metadata = { ...input.metadata };
  }
  if (input.destination) {
    const paymentIntentData: NonNullable<StripeCheckoutParams["payment_intent_data"]> = {
      transfer_data: { destination: input.destination },
    };
    if (input.applicationFeeAmountCents != null) {
      paymentIntentData.application_fee_amount = input.applicationFeeAmountCents;
    }
    params.payment_intent_data = paymentIntentData;
  }
  return params;
}

/**
 * Derive the Checkout return URLs from a client-supplied base — the
 * app's own runtime location — for use when the server environment
 * carries no configured success/cancel URLs. Pure and defensive:
 * anything that is not a clean http(s) URL string of at most 2048
 * chars, with no embedded credentials, yields null and the caller
 * keeps its configured defaults. The cancel URL is the base with any
 * session_id param removed; the success URL is that same URL with
 * session_id set to Stripe's literal {CHECKOUT_SESSION_ID} template
 * placeholder (the placeholder reaches Stripe unencoded in the
 * success_url value, exactly like the configured default URLs).
 */
export function checkoutReturnUrls(returnBase: unknown): { successUrl: string; cancelUrl: string } | null {
  if (typeof returnBase !== "string" || returnBase.length === 0 || returnBase.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(returnBase);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  url.searchParams.delete("session_id");
  const cancelUrl = url.toString();
  url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const successUrl = url
    .toString()
    // URLSearchParams percent-encodes the braces; Stripe substitutes
    // the literal placeholder, so restore it unencoded.
    .replace("session_id=%7BCHECKOUT_SESSION_ID%7D", "session_id={CHECKOUT_SESSION_ID}");
  return { successUrl, cancelUrl };
}

/**
 * Stripe bracket-style form encoding: nested objects become
 * key[sub]=v, arrays become key[0][sub]=v, booleans/numbers are
 * stringified, null/undefined are skipped.
 */
export function encodeStripeForm(params: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (key: string, value: unknown): void => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${key}[${i}]`, item));
      return;
    }
    if (typeof value === "object") {
      for (const [sub, v] of Object.entries(value as Record<string, unknown>)) {
        walk(`${key}[${sub}]`, v);
      }
      return;
    }
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return parts.join("&");
}

export class StripeNotConfiguredError extends Error {
  constructor(message = "Stripe is not configured on the server (STRIPE_SECRET_KEY is not set).") {
    super(message);
    this.name = "StripeNotConfiguredError";
  }
}

export class StripeApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StripeApiError";
    this.status = status;
  }
}

/** The privileged transport's result for a session-create call
 *  (mirrors the stripeCreateCheckoutSession contract in
 *  privileged.ts). The unwrappers below turn it back into the
 *  value-or-throw shape the actions work with. */
export type StripeCreateTransport = {
  ok: boolean;
  notConfigured: boolean;
  status: number | null;
  id: string | null;
  url: string | null;
  errorMessage: string | null;
};

/** A created Checkout Session, or the typed error the transport
 *  reported: StripeNotConfiguredError when no key is configured,
 *  StripeApiError carrying the HTTP status and Stripe's message. */
export function unwrapCreatedSession(r: StripeCreateTransport): { id: string; url: string } {
  if (r.notConfigured) throw new StripeNotConfiguredError();
  if (!r.ok || !r.id || !r.url) {
    throw new StripeApiError(r.status ?? 0, r.errorMessage ?? "Stripe request failed.");
  }
  return { id: r.id, url: r.url };
}

/** The privileged transport's result for a session-retrieve call
 *  (mirrors the stripeRetrieveCheckoutSession contract). */
export type StripeRetrieveTransport = {
  ok: boolean;
  notConfigured: boolean;
  status: number | null;
  sessionStatus: string | null;
  paymentStatus: string | null;
  amountTotalCents: number | null;
  paymentIntentId: string | null;
  errorMessage: string | null;
};

export type RetrievedCheckoutSession = {
  id: string;
  status: string;
  paymentStatus: string;
  amountTotalCents: number | null;
  paymentIntentId: string | null;
};

/** A retrieved Checkout Session's payment state — status /
 *  paymentStatus / amountTotalCents / paymentIntentId mapped from
 *  Stripe's status / payment_status / amount_total / payment_intent
 *  (which the transport normalizes from a string id, an object with
 *  an id, or null) — or the typed error the transport reported. */
export function unwrapRetrievedSession(sessionId: string, r: StripeRetrieveTransport): RetrievedCheckoutSession {
  if (r.notConfigured) throw new StripeNotConfiguredError();
  if (!r.ok) throw new StripeApiError(r.status ?? 0, r.errorMessage ?? "Stripe request failed.");
  return {
    id: sessionId,
    status: r.sessionStatus ?? "",
    paymentStatus: r.paymentStatus ?? "",
    amountTotalCents: r.amountTotalCents,
    paymentIntentId: r.paymentIntentId,
  };
}
