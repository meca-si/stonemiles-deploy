import { describe, expect, test } from "bun:test";
import { parseRateConText } from "./rateConText";

// A typical broker rate confirmation, flattened the way a PDF text
// layer comes out (one logical line per row).
const RATE_CON = `
RATE CONFIRMATION
Broker: Blue Peak Logistics LLC
Broker Contact: Dana Ruiz
MC#: 1234567
Load #: 884120
PO #: PO-55213
Shipper
Acme Steel Co
1200 Industrial Pkwy
Mobile, AL 36608
Pickup
Date: 11/20/2026 08:00 AM
Delivery
Consignee: Gulf Parts Warehouse
4400 Port Rd
Houston, TX 77032
Delivery Date: 11/22/2026 14:00 PM
Commodity: Steel coils
Weight: 42,500 lbs
Pieces: 12
Loaded Miles: 512
Linehaul Rate: $2,450.00
Fuel Surcharge: $180.00
Total Pay: $2,630.00
`;

const MINIMAL = `
Load Tender
Order Number: T-9917
Pickup: Dallas, TX 75207
Delivery: Memphis, TN 38103
Rate: $1,875.00
Weight: 30000 pounds
`;

const NOT_A_LOAD = `
INVOICE FOR OFFICE SUPPLIES
Thank you for your business.
Total: $86.40
Paper, toner, and pens for the front desk.
`;

describe("parseRateConText", () => {
  test("reads a full broker rate con from its labels", () => {
    const f = parseRateConText(RATE_CON);
    expect(f.found).toBe(true);
    expect(f.docKind).toBe("rate_con");
    expect(f.brokerCompany).toBe("Blue Peak Logistics LLC");
    expect(f.brokerName).toBe("Dana Ruiz");
    expect(f.brokerMc).toBe("1234567");
    expect(f.loadNumber).toBe("884120");
    expect(f.poNumber).toBe("PO-55213");
    expect(f.pickupCity).toBe("Mobile");
    expect(f.pickupState).toBe("AL");
    expect(f.deliveryCity).toBe("Houston");
    expect(f.deliveryState).toBe("TX");
    expect(f.pickupText).toContain("11/20/2026");
    expect(f.deliveryText).toContain("11/22/2026");
    expect(f.commodity).toBe("Steel coils");
    expect(f.weightLbs).toBe(42500);
    expect(f.pieces).toBe(12);
    expect(f.miles).toBe(512);
    expect(f.rate).toBe(2450);
    expect(f.chargesFuelSurcharge).toBe(180);
    expect(f.totalPay).toBe(2630);
  });

  test("a single flat total with no itemized charges reads as the rate", () => {
    const f = parseRateConText(MINIMAL);
    expect(f.found).toBe(true);
    expect(f.rate).toBe(1875);
    expect(f.pickupCity).toBe("Dallas");
    expect(f.deliveryCity).toBe("Memphis");
    expect(f.weightLbs).toBe(30000);
  });

  test("never invents: an unrelated document reads as not found, fields null", () => {
    const f = parseRateConText(NOT_A_LOAD);
    expect(f.found).toBe(false);
    expect(f.shipper).toBe(null);
    expect(f.pickupCity).toBe(null);
    expect(f.commodity).toBe(null);
    expect(f.loadNumber).toBe(null);
  });

  test("empty text reads as not found", () => {
    const f = parseRateConText("");
    expect(f.found).toBe(false);
    expect(f.rate).toBe(null);
  });

  test("no seal number is ever guessed", () => {
    const f = parseRateConText(RATE_CON);
    expect(f.sealNumber).toBe(null);
  });
});
