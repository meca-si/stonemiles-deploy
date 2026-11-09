/**
 * Host-side privileged functions — the Stripe Checkout transport.
 *
 * The portable action bundle may not read the host environment (the
 * server validator forbids the `process` global in action-reachable
 * code), so everything that touches STRIPE_SECRET_KEY or calls the
 * Stripe API lives here, behind declared contracts. The secret key is
 * read from the server environment at call time only — never stored,
 * never returned to action code. No Stripe-Version header is sent:
 * the account's default API version applies (never guess a version).
 *
 * The Checkout Session params themselves are built by the pure
 * buildCheckoutSessionParams in stripeCheckout.ts and arrive here
 * already form-encoded; this module is the authenticated transport.
 */

import { definePrivilegedContracts, definePrivilegedHandlers, z } from "@hatch/space-sdk";

export const privileged = definePrivilegedContracts({
  stripeCheckoutConfig: {
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      successUrl: z.string(),
      cancelUrl: z.string(),
    }),
    capabilities: ["env.read"],
    timeoutMs: 15000,
  },
  stripeCreateCheckoutSession: {
    request: z.object({ formBody: z.string() }),
    response: z.object({
      ok: z.boolean(),
      notConfigured: z.boolean(),
      status: z.number().nullable(),
      id: z.string().nullable(),
      url: z.string().nullable(),
      errorMessage: z.string().nullable(),
    }),
    capabilities: ["env.read", "network"],
    timeoutMs: 30000,
  },
  stripeRetrieveCheckoutSession: {
    request: z.object({ sessionId: z.string() }),
    response: z.object({
      ok: z.boolean(),
      notConfigured: z.boolean(),
      status: z.number().nullable(),
      sessionStatus: z.string().nullable(),
      paymentStatus: z.string().nullable(),
      amountTotalCents: z.number().nullable(),
      paymentIntentId: z.string().nullable(),
      errorMessage: z.string().nullable(),
    }),
    capabilities: ["env.read", "network"],
    timeoutMs: 30000,
  },
  // Document-copy email transport (x, 2026-10-30): copies of confirmed
  // load documents are emailed to the driver, dispatch, and the owner /
  // fleet owner. Same staging posture as Stripe above: the transport is
  // real code against the Resend API, and the API key + sender address
  // are read from the server environment at call time only
  // (RESEND_API_KEY / DOC_EMAIL_FROM) — never stored, never returned.
  // With no key configured the transport answers notConfigured and the
  // action layer records the copy as QUEUED; nothing is ever reported
  // as sent without a provider id coming back from here.
  docEmailConfig: {
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      from: z.string().nullable(),
    }),
    capabilities: ["env.read"],
    timeoutMs: 15000,
  },
  sendDocEmail: {
    request: z.object({
      to: z.string(),
      subject: z.string(),
      text: z.string(),
      attachmentBase64: z.string().nullable(),
      attachmentFilename: z.string().nullable(),
    }),
    response: z.object({
      ok: z.boolean(),
      notConfigured: z.boolean(),
      status: z.number().nullable(),
      providerId: z.string().nullable(),
      errorMessage: z.string().nullable(),
    }),
    capabilities: ["env.read", "network"],
    timeoutMs: 30000,
  },
});

const DEFAULT_SUCCESS_URL = "https://example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}";
const DEFAULT_CANCEL_URL = "https://example.com/checkout/cancel";

function stripeKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? key : null;
}

function docEmailKey(): string | null {
  const key = process.env.RESEND_API_KEY;
  return key ? key : null;
}

function docEmailFrom(): string | null {
  const from = process.env.DOC_EMAIL_FROM;
  return from ? from : null;
}

export const privilegedHandlers = definePrivilegedHandlers(privileged, {
  stripeCheckoutConfig() {
    return {
      configured: stripeKey() != null,
      successUrl: process.env.STRIPE_CHECKOUT_SUCCESS_URL ?? DEFAULT_SUCCESS_URL,
      cancelUrl: process.env.STRIPE_CHECKOUT_CANCEL_URL ?? DEFAULT_CANCEL_URL,
    };
  },

  async stripeCreateCheckoutSession(args) {
    const key = stripeKey();
    if (!key) {
      return { ok: false, notConfigured: true, status: null, id: null, url: null, errorMessage: null };
    }
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: args.formBody,
    });
    const data = (await res.json().catch(() => null)) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      return {
        ok: false,
        notConfigured: false,
        status: res.status,
        id: null,
        url: null,
        errorMessage: data?.error?.message ?? `Stripe request failed (HTTP ${res.status}).`,
      };
    }
    if (!data?.id || !data?.url) {
      return {
        ok: false,
        notConfigured: false,
        status: res.status,
        id: null,
        url: null,
        errorMessage: "Stripe returned a session without an id or URL.",
      };
    }
    return { ok: true, notConfigured: false, status: res.status, id: data.id, url: data.url, errorMessage: null };
  },

  async stripeRetrieveCheckoutSession(args) {
    const key = stripeKey();
    if (!key) {
      return {
        ok: false,
        notConfigured: true,
        status: null,
        sessionStatus: null,
        paymentStatus: null,
        amountTotalCents: null,
        paymentIntentId: null,
        errorMessage: null,
      };
    }
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(args.sessionId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = (await res.json().catch(() => null)) as {
      id?: string;
      status?: string;
      payment_status?: string;
      amount_total?: number | null;
      payment_intent?: string | { id?: string } | null;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      return {
        ok: false,
        notConfigured: false,
        status: res.status,
        sessionStatus: null,
        paymentStatus: null,
        amountTotalCents: null,
        paymentIntentId: null,
        errorMessage: data?.error?.message ?? `Stripe request failed (HTTP ${res.status}).`,
      };
    }
    const pi = data?.payment_intent;
    const paymentIntentId = typeof pi === "string" ? pi : pi && typeof pi === "object" ? (pi.id ?? null) : null;
    return {
      ok: true,
      notConfigured: false,
      status: res.status,
      sessionStatus: data?.status ?? "",
      paymentStatus: data?.payment_status ?? "",
      amountTotalCents: data?.amount_total ?? null,
      paymentIntentId,
      errorMessage: null,
    };
  },

  docEmailConfig() {
    return {
      configured: docEmailKey() != null && docEmailFrom() != null,
      from: docEmailFrom(),
    };
  },

  async sendDocEmail(args) {
    const key = docEmailKey();
    const from = docEmailFrom();
    if (!key || !from) {
      return { ok: false, notConfigured: true, status: null, providerId: null, errorMessage: null };
    }
    const body: Record<string, unknown> = {
      from,
      to: [args.to],
      subject: args.subject,
      text: args.text,
    };
    if (args.attachmentBase64 && args.attachmentFilename) {
      body.attachments = [{ filename: args.attachmentFilename, content: args.attachmentBase64 }];
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as {
      id?: string;
      message?: string;
    } | null;
    if (!res.ok) {
      return {
        ok: false,
        notConfigured: false,
        status: res.status,
        providerId: null,
        errorMessage: data?.message ?? `Email request failed (HTTP ${res.status}).`,
      };
    }
    if (!data?.id) {
      return {
        ok: false,
        notConfigured: false,
        status: res.status,
        providerId: null,
        errorMessage: "The mail provider returned no message id.",
      };
    }
    return { ok: true, notConfigured: false, status: res.status, providerId: data.id, errorMessage: null };
  },
});
