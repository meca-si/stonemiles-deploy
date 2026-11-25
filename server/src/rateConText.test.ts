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

// The BVB Express layout (the 2026-11-24 live failure): labels and
// values on SEPARATE lines, facility codes printed as "CODE-- City",
// an explicit "Address:" line, the carrier's MC as a label/value
// pair, the broker's MC on its own letterhead, a shipment table whose
// header row names the COMMODITY column, and numbered terms prose
// that mentions detention with no $ attached.
const BVB_CON = `
CARRIER RATE AND LOAD CONFIRMATION
LOAD NUMBER
31229
BROKER NAME
Tim Miller
BROKER PHONE
CARRIER NAME
ROBERT L GAST INC
CARRIER MC#
326661
EQUIPMENT TYPE
53' Van
SHIPPER — PICKUP
SHIPPER NAME AND ADDRESS
BRWY-- Jacksonville
Address: 111 BUSCH DRIVE
JACKSONVILLE, FL 32218
EXPECTED DATE 11/24/2026
PICKUP INSTRUCTIONS
9PM
SHIPPER REFERENCES
CONSIGNEE — DELIVERY
CONSIGNEE NAME AND ADDRESS
WSLR-- Bama Bud Of Montgomery Inc
Address: 1700 EMORY FOLMAR BLVD.
MONTGOMERY, AL 36110
EXPECTED DATE 11/25/2026
DELIVERY INSTRUCTIONS
7AM
CONSIGNEE REFERENCES
SHIPMENT INFORMATION
HANDLING UNIT PACKAGE WEIGHT HM (X) COMMODITY DESCRIPTION LTL ONLY
QTY TYPE QTY TYPE NMFC # CLASS
CARRIER FEES
Freight Charges
NET LINE HAUL
TOTAL COST $ 600.00
SIGNATURE DATE
Signing the first page implies agreement with the policy and terms on page 2.
Page 1 Of 2
BVB EXPRESS LLC
CARRIER RATE AND LOAD CONFIRMATION — CONTINUED
160 NW GILMAN BLVD, STE 243
ISSAQUAH, WA 98027
MC 1164350
Terms and Conditions
11. THE BROKER WILL NOT PAY DETENTION OR LAYOVER CHARGES.
15. WHEN ACCEPTING THIS RATE CONFIRMATION, THE CARRIER CONFIRMS THAT BVB EXPRESS LLC IS OFFICIALLY LISTED ON THEIR CARGO INSURANCE WITH THE ADDRESS "160 NW GILMAN BLVD STE 243 ISSAQUAH, WA 98027". THE INSURANCE COVERAGE CONTAINS AT LEAST $100,000. IF NOT, THE SHIPMENT WILL NOT BE PAID.
`;

describe("parseRateConText — BVB separate-lines layout", () => {
  test("labels and values on separate lines resolve", () => {
    const f = parseRateConText(BVB_CON);
    expect(f.found).toBe(true);
    expect(f.loadNumber).toBe("31229");
    expect(f.brokerName).toBe("Tim Miller");
    expect(f.carrier).toBe("ROBERT L GAST INC");
  });

  test("the label is never read as the shipper; CODE-- City gives the code", () => {
    const f = parseRateConText(BVB_CON);
    expect(f.shipper).toBe("BRWY");
    expect(f.consignee).toBe("Bama Bud Of Montgomery Inc");
    expect(f.pickupAddress).toBe("111 BUSCH DRIVE");
    expect(f.deliveryAddress).toBe("1700 EMORY FOLMAR BLVD");
    expect(f.pickupCity).toBe("JACKSONVILLE");
    expect(f.pickupState).toBe("FL");
    expect(f.deliveryCity).toBe("MONTGOMERY");
    expect(f.deliveryState).toBe("AL");
  });

  test("the broker MC is the letterhead MC, not the carrier's", () => {
    const f = parseRateConText(BVB_CON);
    expect(f.brokerMc).toBe("1164350");
    expect(f.brokerCompany).toBe("BVB EXPRESS LLC");
  });

  test("TOTAL COST is the rate; the blank shipment table stays blank", () => {
    const f = parseRateConText(BVB_CON);
    expect(f.rate).toBe(600);
    expect(f.totalPay).toBe(600);
    expect(f.commodity).toBe(null);
    expect(f.weightLbs).toBe(null);
    expect(f.miles).toBe(null);
  });

  test("terms prose never becomes an itemized charge", () => {
    const f = parseRateConText(BVB_CON);
    expect(f.chargesDetention).toBe(null);
    expect(f.chargesFuelSurcharge).toBe(null);
    expect(f.chargesOther).toBe(null);
  });

  test("bare instruction times join the appointment texts", () => {
    const f = parseRateConText(BVB_CON);
    expect(f.pickupText).toBe("11/24/2026 9PM");
    expect(f.deliveryText).toBe("11/25/2026 7AM");
  });
});
