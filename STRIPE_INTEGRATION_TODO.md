## Values to Replace

The return URLs are no longer values to set by hand before live use. They are resolved at checkout time, as described below. The `example.com` values remain in the code only as last-resort defaults.

**Files:**
- [server/src/privileged.ts](server/src/privileged.ts) — last-resort defaults and env overrides
- [server/src/stripeCheckout.ts](server/src/stripeCheckout.ts) — `checkoutReturnUrls` helper

| Field | Current Value | How It Is Resolved Now |
|-------|--------------|------------------------|
| success_url | https://example.com/checkout/success?session_id={CHECKOUT_SESSION_ID} (the STRIPE_CHECKOUT_SUCCESS_URL default in server/src/privileged.ts) | Last-resort default only. The STRIPE_CHECKOUT_SUCCESS_URL env override still wins whenever it is set to a non-placeholder value. Otherwise the success URL is derived at checkout time (see below). |
| cancel_url | https://example.com/checkout/cancel (the STRIPE_CHECKOUT_CANCEL_URL default in server/src/privileged.ts) | Last-resort default only. The STRIPE_CHECKOUT_CANCEL_URL env override still wins whenever it is set to a non-placeholder value. Otherwise the cancel URL is derived at checkout time (see below). |
| line_items[].price | (none — inline price_data) | BY DESIGN: dispatch fees vary per load, so line_items use inline price_data (currency usd, unit_amount = the invoice fee in cents, product name "STONEMILES dispatch fee — load #<id>"). The Stripe-catalog alternative (fixed Price IDs via PostPrices) only fits fixed amounts and is not used. |

**Why the return URLs are derived, not configured:** this platform provides no per-space environment configuration, and the app is a private fullstack artifact served framed from per-space subdomains (document base `/spaces/v2/trucker-gps/`) with no fixed public origin. There is no single real origin to put in an env var.

**How derivation works:**

- The Load Board's Pay-by-card passes `returnBase` (`window.location.origin + pathname`) to `createDispatchFeeCheckout`.
- The pure `checkoutReturnUrls` helper in server/src/stripeCheckout.ts validates it (http/https only, ≤2048 chars, no credentials) and produces:
  - the **cancel URL** — the base with any `session_id` removed, and
  - the **success URL** — the same base with `session_id={CHECKOUT_SESSION_ID}`.
- The in-app return route lives in the root App component: on load it reads `session_id` from the URL, matches it against the pending checkout the client stashed in localStorage (key `stonemiles.pendingStripeCheckout`, `{sessionId, loadId}`), calls `syncDispatchFeeCheckout`, strips the param, and banners the outcome.

## Configured Parameters

These parameters were configured in Checkout Studio and are already set correctly.

**Files containing these parameters:**
- [server/src/stripeCheckout.ts](server/src/stripeCheckout.ts) — buildCheckoutSessionParams

| Parameter | Value |
|-----------|-------|
| ui_mode | hosted_page (note: no Stripe SDK is used — raw API via fetch, so the SDK-version rule does not bite; the account's default API version applies because no Stripe-Version header is sent) |
| billing_address_collection | auto |
| phone_number_collection | {enabled:false} |
| automatic_tax | {enabled:false} |
| allow_promotion_codes | false |
| submit_type | auto |
| integration_identifier | hosted_mobile_app_0001 |
| origin_context | mobile_app |
| mode | payment |
| payment_method_collection | intentionally omitted (Studio Rule 8: subscription mode only) |

## Setup and next steps

`STRIPE_SECRET_KEY` is **still NOT set**, and there is currently **no supported mechanism to set it for this space**.

The TS-space runtime exposes no per-space env/secret configuration:

- `space.json` has no env field.
- The server worker is spawned by the platform daemon with only platform `HATCH_*` variables.
- Privileged handlers run in a daemon-spawned subprocess inheriting the daemon's environment, whose only env files are installer-managed and root-owned.
- The Secure Vault serves browser sign-ins, not space server env.

The integration therefore remains in its honest not-configured state: `createDispatchFeeCheckout` returns `available:false` with the "being set up" note.

**Remaining step:** once the platform offers a space env/secret channel (or an operator with host access sets the variable in the daemon's environment and restarts it), the user enters the sandbox test key (`sk_test_...` from the RUGGS LLC Stripe sandbox account, Developers → API keys) through that channel — never through chat, code, or this file. The live key stays sealed until the user's explicit go-live decision.

**End-to-end check, once the test key is in:** create a checkout for a real dispatch-fee invoice, pay with test card 4242 4242 4242 4242, return to the app, and confirm `syncDispatchFeeCheckout` records the payment and opens the settle-to-claim gate.

Flow overview: dispatch-fee invoice exists (POD sealed) → desk calls createDispatchFeeCheckout → Stripe-hosted page (ui_mode hosted_page, opened from the invoice's Pay by card button / debit link) → payer completes → return to the app, where the in-app return route calls syncDispatchFeeCheckout → payment recorded through the existing recordDispatchFeePayment path with rail "debit" and the Stripe payment_intent id as reference → settle-to-claim gate opens.

Test cards: 4242 4242 4242 4242, any future expiry, any CVC (test mode only).

Known gaps / hardening:

1. Checkout session ids are held only in server memory for the invoice read — a server restart drops the surfaced link; status sync takes the session id as an explicit input, so nothing is lost, but durable persistence (a column on dispatch_fee_invoices) is a deliberate future migration, not done here.
2. Production hardening is a Stripe webhook endpoint for checkout.session.completed — the app stack exposes no public webhook route yet, so v1 uses explicit status sync (triggered from the in-app return route described above).
3. Rail 1 (Instant Pay pay-at-delivery destination charges) reuses buildCheckoutSessionParams' Connect fields (destination + application_fee_amount) once carrier Connect onboarding ships — nothing passes a destination yet.
