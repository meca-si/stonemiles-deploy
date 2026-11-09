import { describe, expect, test } from "bun:test";
import { buildCheckoutSessionParams, checkoutReturnUrls, encodeStripeForm } from "./stripeCheckout";

const BASE = {
  amountCents: 25000,
  productName: "STONEMILES dispatch fee — load #42",
  successUrl: "https://example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://example.com/checkout/cancel",
};

describe("buildCheckoutSessionParams — Checkout Studio fixed_by_ui values", () => {
  test("every fixed_by_ui value is present verbatim", () => {
    const p = buildCheckoutSessionParams(BASE);
    expect(p.ui_mode).toBe("hosted_page");
    expect(p.billing_address_collection).toBe("auto");
    expect(p.phone_number_collection).toEqual({ enabled: false });
    expect(p.automatic_tax).toEqual({ enabled: false });
    expect(p.allow_promotion_codes).toBe(false);
    expect(p.submit_type).toBe("auto");
    expect(p.integration_identifier).toBe("hosted_mobile_app_0001");
    expect(p.origin_context).toBe("mobile_app");
  });

  test("mode is payment and payment_method_collection appears nowhere (Studio Rule 8)", () => {
    const p = buildCheckoutSessionParams(BASE);
    expect(p.mode).toBe("payment");
    expect("payment_method_collection" in p).toBe(false);
    expect(JSON.stringify(p)).not.toContain("payment_method_collection");
  });

  test("exactly one line item with inline price_data mapped from the input", () => {
    const p = buildCheckoutSessionParams(BASE);
    expect(p.line_items).toHaveLength(1);
    const item = p.line_items[0]!;
    expect(item.quantity).toBe(1);
    expect(item.price_data.currency).toBe("usd");
    expect(item.price_data.unit_amount).toBe(BASE.amountCents);
    expect(item.price_data.product_data.name).toBe(BASE.productName);
  });

  test("success_url and cancel_url pass through from the input", () => {
    const p = buildCheckoutSessionParams(BASE);
    expect(p.success_url).toBe(BASE.successUrl);
    expect(p.cancel_url).toBe(BASE.cancelUrl);
  });

  test("metadata passes through when provided and is omitted when not", () => {
    const withMeta = buildCheckoutSessionParams({
      ...BASE,
      metadata: { purpose: "dispatch_fee", loadId: "42", invoiceRef: "DFI-7" },
    });
    expect(withMeta.metadata).toEqual({ purpose: "dispatch_fee", loadId: "42", invoiceRef: "DFI-7" });
    const without = buildCheckoutSessionParams(BASE);
    expect("metadata" in without).toBe(false);
    const empty = buildCheckoutSessionParams({ ...BASE, metadata: {} });
    expect("metadata" in empty).toBe(false);
  });

  test("payment_intent_data is absent without a destination", () => {
    const p = buildCheckoutSessionParams(BASE);
    expect("payment_intent_data" in p).toBe(false);
    const feeOnly = buildCheckoutSessionParams({ ...BASE, applicationFeeAmountCents: 2500 });
    expect("payment_intent_data" in feeOnly).toBe(false);
  });

  test("with a destination, transfer_data is set and the fee appears only when given", () => {
    const noFee = buildCheckoutSessionParams({ ...BASE, destination: "acct_test123" });
    expect(noFee.payment_intent_data?.transfer_data.destination).toBe("acct_test123");
    expect(noFee.payment_intent_data && "application_fee_amount" in noFee.payment_intent_data).toBe(false);
    const withFee = buildCheckoutSessionParams({
      ...BASE,
      destination: "acct_test123",
      applicationFeeAmountCents: 2500,
    });
    expect(withFee.payment_intent_data?.transfer_data.destination).toBe("acct_test123");
    expect(withFee.payment_intent_data?.application_fee_amount).toBe(2500);
  });
});

describe("encodeStripeForm", () => {
  test("nested objects and arrays use Stripe bracket encoding", () => {
    const body = encodeStripeForm(buildCheckoutSessionParams(BASE) as unknown as Record<string, unknown>);
    expect(body).toContain("ui_mode=hosted_page");
    expect(body).toContain("phone_number_collection[enabled]=false");
    expect(body).toContain("line_items[0][quantity]=1");
    expect(body).toContain("line_items[0][price_data][currency]=usd");
    expect(body).toContain("line_items[0][price_data][unit_amount]=25000");
    expect(body).toContain(
      `line_items[0][price_data][product_data][name]=${encodeURIComponent(BASE.productName)}`,
    );
    expect(body).not.toContain("payment_intent_data");
  });

  test("null and undefined values are skipped", () => {
    expect(encodeStripeForm({ a: null, b: undefined, c: "x" })).toBe("c=x");
  });
});

describe("checkoutReturnUrls", () => {
  test("a plain https base: cancel is the base, success carries the literal placeholder", () => {
    const r = checkoutReturnUrls("https://muse.ai/spaces/v2/trucker-gps/");
    expect(r).not.toBeNull();
    expect(r!.cancelUrl).toBe("https://muse.ai/spaces/v2/trucker-gps/");
    expect(r!.successUrl).toBe("https://muse.ai/spaces/v2/trucker-gps/?session_id={CHECKOUT_SESSION_ID}");
  });

  test("an http base is accepted", () => {
    const r = checkoutReturnUrls("http://localhost:3000/app");
    expect(r!.cancelUrl).toBe("http://localhost:3000/app");
    expect(r!.successUrl).toBe("http://localhost:3000/app?session_id={CHECKOUT_SESSION_ID}");
  });

  test("a base that already has query params keeps them on both URLs", () => {
    const r = checkoutReturnUrls("https://example.test/app?tab=board&view=fees");
    expect(r!.cancelUrl).toBe("https://example.test/app?tab=board&view=fees");
    expect(r!.successUrl).toBe("https://example.test/app?tab=board&view=fees&session_id={CHECKOUT_SESSION_ID}");
  });

  test("a base already carrying session_id has it replaced, not duplicated", () => {
    const r = checkoutReturnUrls("https://example.test/app?session_id=cs_old&tab=board");
    expect(r!.cancelUrl).toBe("https://example.test/app?tab=board");
    expect(r!.successUrl).toBe("https://example.test/app?tab=board&session_id={CHECKOUT_SESSION_ID}");
    expect(r!.successUrl).not.toContain("cs_old");
  });

  test("invalid inputs return null", () => {
    expect(checkoutReturnUrls(undefined)).toBeNull();
    expect(checkoutReturnUrls(null)).toBeNull();
    expect(checkoutReturnUrls(42)).toBeNull();
    expect(checkoutReturnUrls({ url: "https://example.test/" })).toBeNull();
    expect(checkoutReturnUrls("not a url")).toBeNull();
    expect(checkoutReturnUrls("")).toBeNull();
    expect(checkoutReturnUrls("ftp://example.test/app")).toBeNull();
    expect(checkoutReturnUrls("https://user:pass@example.test/app")).toBeNull();
    expect(checkoutReturnUrls("https://user@example.test/app")).toBeNull();
    expect(checkoutReturnUrls(`https://example.test/${"a".repeat(2048)}`)).toBeNull();
  });

  test("a base at exactly 2048 chars is accepted", () => {
    const prefix = "https://example.test/";
    const base = prefix + "a".repeat(2048 - prefix.length);
    expect(base.length).toBe(2048);
    expect(checkoutReturnUrls(base)).not.toBeNull();
  });
});
