// Drizzle schema for STONEMILES.
//
// Two user-owned tables:
// - profile: single-row truck + fuel settings (id = 1), created lazily on
//   first save. Ships empty — defaults live in the client until the driver
//   saves their own numbers.
// - trips: completed trip sheets from the state-line mileage log. Each row
//   stores the per-state breakdown as JSON (full state names), total miles,
//   and pay at the job's $0.55/mile rate.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profile = sqliteTable("profile", {
  // Auth Phase 2b: the accounts.id this profile belongs to (null until
  // the owner claim / invite acceptance links it). Unique — one account
  // owns exactly one profile. See AUTH-DESIGN.md §2.1/§4.4.
  accountId: integer("account_id").unique(),
  id: integer("id").primaryKey(),
  heightFt: integer("height_ft").notNull(),
  heightIn: integer("height_in").notNull(),
  weightLbs: integer("weight_lbs").notNull(),
  lengthFt: integer("length_ft").notNull(),
  mpg: real("mpg").notNull(),
  dieselPrice: real("diesel_price").notNull(),
  tankRangeMi: integer("tank_range_mi").notNull(),
  // Brand filters for fuel stops: true = brand excluded from stops/recs.
  lovesOff: integer("loves_off", { mode: "boolean" }).notNull().default(false),
  pilotOff: integer("pilot_off", { mode: "boolean" }).notNull().default(false),
  // Every other truck-stop brand the driver has turned OFF, as a
  // comma-separated list of brand keys (ta, petro, sapp, kwik, caseys,
  // maverik, roadranger, ambest, bosselman, truckplaza). Brands not listed
  // are ON. loves/pilot keep their own columns above (the driver's saved
  // choices predate this list); the actions keep all three in sync.
  brandOffs: text("brand_offs").notNull().default(""),
  // "AI runs it" automation toggles (all ON by default).
  autoRoute: integer("auto_route", { mode: "boolean" }).notNull().default(true),
  autoTrip: integer("auto_trip", { mode: "boolean" }).notNull().default(true),
  autoAlerts: integer("auto_alerts", { mode: "boolean" }).notNull().default(true),
  autoFuel: integer("auto_fuel", { mode: "boolean" }).notNull().default(true),
  autoSeal: integer("auto_seal", { mode: "boolean" }).notNull().default(true),
  // Route-pick priority order for the auto picker.
  priority1: text("priority_1").notNull().default("safety"),
  priority2: text("priority_2").notNull().default("net"),
  priority3: text("priority_3").notNull().default("time"),
  // HazMat: driver hauls placarded loads — routing treats hazmat-flagged
  // roads/tunnels as planning-aid warnings (posted signs rule).
  hazmat: integer("hazmat", { mode: "boolean" }).notNull().default(false),
  hazmatClass: text("hazmat_class"),
  // SHA-256 of the app-lock PIN (never the PIN itself). Null = no lock.
  pinHash: text("pin_hash"),
  // The trailer number the driver currently has hooked (drop & hook
  // swaps change it). Null = no trailer currently recorded as hooked.
  currentTrailer: text("current_trailer"),
  // Trailer Package (migration 0101): the driver's ONE active trailer
  // type — dry_van | reefer | flatbed | step_deck | rgn. It extends the
  // truck-dimension profile (same row, same save path): the type tunes
  // default heights, which trailer tools surface first, and which
  // pre-trip checklist the driver gets. Switchable any time.
  trailerType: text("trailer_type").notNull().default("dry_van"),
  // Display name the driver posts under in Company Chat.
  chatName: text("chat_name").notNull().default("Driver"),
  // Company-driver pay (migration 0042): the carrier the driver works
  // for and the per-mile rate (CPM, $/mi) that carrier pays them. Both
  // are the driver's own entries — null until they set them. A null
  // driverCpm means "not set": pay math falls back to the standing
  // $0.55/mi default, and the UI says so plainly wherever it shows.
  companyName: text("company_name"),
  driverCpm: real("driver_cpm"),
  // Pay basis (migration 0043): HOW the company pays this driver —
  // "cpm" (per-mile rate in driverCpm) or "percent" (driverPayPct % of
  // the load's pay: rate + additional charges). Both values are the
  // driver's own entries, kept side by side so switching basis never
  // erases the other. driverPayPct is null until a percent-paid driver
  // sets it; percent pay math only ever runs off a load's real gross —
  // with no load rate on file the app says so instead of inventing one.
  payBasis: text("pay_basis").notNull().default("cpm"),
  driverPayPct: real("driver_pay_pct"),
  // The driver's OWN per-load fee percentages (migration 0115): what
  // THEIR factoring company and THEIR dispatcher take out of a load's
  // gross pay, in percent (0–100, 0 = they don't pay that fee). These
  // are the driver's own costs, entered by the driver — they are NOT
  // platform fees (the platform dispatch/platform fees live elsewhere
  // and are never stored here). The Worth-It Advisor deducts them from
  // a load's gross before scoring it, and True Rate shows them per
  // load. Default 0 = no deduction, exactly the pre-0115 behaviour.
  factoringPct: real("factoring_pct").notNull().default(0),
  dispatcherPct: real("dispatcher_pct").notNull().default(0),
  // The driver's social handle (usernames are how people follow/DM/add).
  socialUsername: text("social_username").notNull().default("driver"),
  // Subscription plan recorded for the app-store release ("basic" |
  // "gold" | "diamond" | "owner"); billing does not exist in this
  // staging build. Legacy values "simple"/"full" were renamed by
  // migration 0027 (simple → basic, full → diamond) and are still
  // normalized on read in actions.ts for any unmigrated row.
  // Plan prices are LOCKED (set by x 2026-10-22) and live in the pricing
  // constants in actions.ts — they are not stored per user. ownerPrice is
  // a legacy column from the earlier "price at signup" design; it is no
  // longer read or written. The Owner plan total instead derives from
  // the fleet size the owner picks at signup: ownerTrucks (drivers /
  // trucks on the plan) and ownerSeats (dispatch seats).
  plan: text("plan").notNull().default("diamond"),
  ownerPrice: real("owner_price"),
  ownerTrucks: integer("owner_trucks").notNull().default(3),
  ownerSeats: integer("owner_seats").notNull().default(1),
  // One-time identity check for cash-out (the law; handled by the licensed
  // payout provider — the app never sees ID documents). not_started |
  // in_review | verified. At go-live the provider's webhook sets this;
  // in staging the owner records it the same way.
  kycStatus: text("kyc_status").notNull().default("not_started"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Provider fraud holds on card-bought $STONER (licensed providers can hold
// a FIRST card purchase before those funds can leave). While a hold is
// active the wallet shows the held amount, the plain-words reason, and a
// countdown to available_at — the app never promises instant when the
// provider hasn't released the funds. At go-live the provider's webhook
// writes these rows; in staging the owner records them the same way.
export const cashoutHolds = sqliteTable("cashout_holds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  amountStoner: real("amount_stoner").notNull(),
  reason: text("reason").notNull(),
  availableAt: integer("available_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// SUBSCRIBER GIVEAWAY (owner rework, 2026-10-25 — replaces the old
// weekly GPS-activity giveaway entirely). The draw pool is the paying
// subscribers: a cycle fills when 5 NEW paid Gold subscriptions + 10 NEW
// paid Diamond subscriptions have been counted (giveaway_cycles +
// giveaway_cycle_entries, written only by the settled-subscription path —
// comped / fleet-included seats never count, House Rule 4). Each filled
// cycle runs ONE draw of 100,000 $STONER from the Reward Wallet: 25,000
// to one randomly drawn Gold subscriber, 75,000 to one randomly drawn
// Diamond subscriber. Both prizes vest 25% at payout + 25%/month × 3 in
// giveaway_vesting. A filled cycle whose Reward Wallet can't cover the
// full pot QUEUES publicly ("queued — waiting on pool balance") — never
// an unfunded promise. Draws stay gated OFF (GIVEAWAY_LIVE) until the
// Nov 20 launch + the owner's go-live approval. The giveaway_entries /
// giveaway_locks tables below are the RETIRED weekly-activity design —
// no code writes or reads them anymore; they remain only so historical
// staging rows stay readable.
export const giveawayEntries = sqliteTable("giveaway_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  weekKey: text("week_key").notNull(), // ISO week: "2026-W43"
  kind: text("kind").notNull(), // trip | ontime | intel
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const giveawayLocks = sqliteTable("giveaway_locks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekKey: text("week_key").notNull().unique(),
  prizesJson: text("prizes_json").notNull(), // locked prize list, e.g. "[10000,1000,1000,100,...]"
  walletBalance: real("wallet_balance").notNull(),
  lockedAt: integer("locked_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const giveawayDraws = sqliteTable("giveaway_draws", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekKey: text("week_key").notNull(),
  prizesJson: text("prizes_json").notNull(),
  winnersJson: text("winners_json").notNull(), // [{username, prize, vested}]
  drawnAt: integer("drawn_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const giveawayVesting = sqliteTable("giveaway_vesting", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  drawId: integer("draw_id").notNull(),
  trancheNo: integer("tranche_no").notNull(),
  totalTranches: integer("total_tranches").notNull(),
  amountStoner: real("amount_stoner").notNull(),
  dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("pending"), // pending | paid
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
});

// Subscriber-giveaway cycles (migration 0044). One open cycle at a time
// (status "filling"); when its counters reach 5 Gold + 10 Diamond it
// flips to "ready" (Reward Wallet covers the 100,000 pot) or "queued"
// (wallet short — public queue state, House Rule 6), and to "drawn"
// after its draw runs behind the go-live gate.
export const giveawayCycles = sqliteTable("giveaway_cycles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goldCount: integer("gold_count").notNull().default(0),
  diamondCount: integer("diamond_count").notNull().default(0),
  status: text("status").notNull().default("filling"), // filling | ready | queued | drawn
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  drawnAt: integer("drawn_at", { mode: "timestamp_ms" }),
});

// One row per NEW paid Gold/Diamond subscription counted toward a
// giveaway cycle — the draw pool for that cycle. Written only by the
// settled-subscription path for real paying subscribers (House Rule 4:
// comped or fleet-included seats never land here).
export const giveawayCycleEntries = sqliteTable("giveaway_cycle_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cycleId: integer("cycle_id").notNull(),
  username: text("username").notNull(),
  tier: text("tier").notNull(), // gold | diamond
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Settled subscription payment events (migration 0044) — the record the
// rewards rules run on. One row per settled payment (payment_ref is the
// idempotency key: a retried webhook/checkout can never double-pay
// rewards). kind "new" = a new paid subscription, "renewal" = a renewal.
// points_awarded is what the event granted (promo payments grant at the
// value actually paid, House Rule 5); counted_for_giveaway marks a NEW
// Gold/Diamond sub counted toward a giveaway cycle; reversed flips on a
// refund/chargeback clawback (House Rule 1). In staging the plan-choice
// flow records these; at go-live the billing path posts them when a
// payment SETTLES — never on an attempted/pending/failed payment
// (House Rule 2).
export const subscriptionEvents = sqliteTable("subscription_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  plan: text("plan").notNull(), // gold | diamond | owner
  period: text("period").notNull().default("monthly"), // monthly | yearly
  kind: text("kind").notNull().default("new"), // new | renewal
  paymentRef: text("payment_ref").notNull().unique(),
  pointsAwarded: integer("points_awarded").notNull().default(0),
  discounted: integer("discounted", { mode: "boolean" }).notNull().default(false),
  countedForGiveaway: integer("counted_for_giveaway", { mode: "boolean" }).notNull().default(false),
  reversed: integer("reversed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const trips = sqliteTable("trips", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }).notNull(),
  totalMiles: real("total_miles").notNull(),
  totalPay: real("total_pay").notNull(),
  // JSON: [{ state: "Alabama", miles: 12.3, pay: 6.77 }, ...]
  stateBreakdown: text("state_breakdown").notNull(),
  destination: text("destination"),
  // Pace aggregates the client measured during the trip (GPS): average
  // moving speed and minutes spent over the posted limit. Null on trips
  // saved before pace tracking — never back-filled or estimated.
  avgSpeedMph: real("avg_speed_mph"),
  overLimitMin: real("over_limit_min"),
  // JSON: [{ startAt, endAt, reason: "app_closed"|"signal_lost",
  // estimateMiles|null }] — tracking gaps stamped into the sheet.
  // Gap miles are NEVER counted in totalMiles/totalPay; estimateMiles
  // is a straight-line estimate shown separately, labelled "estimate".
  // Null on trips saved before gap tracking — never back-filled.
  gaps: text("gaps"),
  // The 1-mile auto-start duty prompt outcome for this trip, in words
  // (e.g. "Duty prompt at auto-start: driver chose to stay in Sleeper
  // Berth while moving — status logged as chosen"). Duty status is
  // NEVER auto-changed; this note is the auditable record of the
  // driver's choice (or no-answer). Null when no prompt fired.
  dutyNote: text("duty_note"),
  // Where this trip's miles came from: "GPS" (phone GPS, the fallback and
  // the only source until an ELD feed actually delivers an odometer
  // reading) or "ELD odometer — Samsara" / "ELD odometer — Motive" when
  // the connected ELD's vehicle-stats feed supplied the odometer. Set
  // server-side at save time from real snapshot data — never from a
  // client claim alone.
  milesSource: text("miles_source").notNull().default("GPS"),
  // Trailer number that hauled this trip (the driver's current trailer
  // at save time). Null on trips saved before trailer tracking.
  trailerNumber: text("trailer_number"),
  // Company-driver additional charges (migration 0042): flat extra pay
  // on top of mileage pay for this trip (detention, layover, extra
  // stops, tarp, etc. — the note says what it was for). Included in
  // totalPay. The pay-rate snapshot is the $/mi the sheet was paid at
  // (the trip's own rate, else the driver's company CPM). 0 / null on
  // trips saved before this existed — never back-filled.
  extraCharges: real("extra_charges").notNull().default(0),
  extraChargesNote: text("extra_charges_note"),
  payRate: real("pay_rate"),
  // Pay-basis snapshot (migration 0043): how THIS sheet was paid —
  // "cpm" (payRate $/mi) or "percent" (payPercent % of loadGross, the
  // linked load's rate + charges at save time). Per-state pay on a
  // percent sheet is the driver's cut split by state miles. Null
  // percent/gross on sheets saved before this existed — never
  // back-filled. A percent sheet with loadGross null states plainly
  // that its percent pay wasn't figured (no gross was on file).
  payBasis: text("pay_basis").notNull().default("cpm"),
  payPercent: real("pay_percent"),
  loadGross: real("load_gross"),
  // Multiple trips (migration 0027): the driver-given trip label and
  // the trip_queue row this sheet completed. Null on trips saved
  // before the queue existed — never back-filled.
  label: text("label"),
  queueId: integer("queue_id"),
  // Fuel Coach aggregates the client measured from GPS during the trip
  // (migration 0028): minutes over 65 / over 70 mph and stationary
  // "probable idle" minutes. Estimates from GPS, never engine data.
  // Null on trips saved before coach tracking — never back-filled.
  over65Min: real("over65_min"),
  over70Min: real("over70_min"),
  idleMin: real("idle_min"),
  // GPS fix-quality aggregates the client tallied from the fix filter
  // during the trip (migration 0046): JSON { accepted, rejAccuracy,
  // rejJump, rejTime, accLe10, accLe25, accLe50, accLe65, accGt65,
  // accNone } — accepted vs rejected fix counts and the accuracy
  // distribution of every raw fix. Measured, never estimated. Null on
  // trips saved before fix-quality tracking — never back-filled.
  fixQuality: text("fix_quality"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Multiple trips queue (migration 0027). A driver can create and keep
// MULTIPLE trips — each one its own record with a name/label, origin /
// destination, its own linked load, stops, and pay rate. Exactly one
// queue row is "active" (GPS logging) at a time; the rest sit
// "planned" or "paused" until the driver switches. When the active
// trip's sheet is saved, the row flips to "completed" and links the
// saved trips row (completedTripId) — the sheet itself stays in
// `trips`, sealed as always. Production starts EMPTY.
export const tripQueue = sqliteTable("trip_queue", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  origin: text("origin"),
  destination: text("destination"),
  // planned | active | paused | completed
  status: text("status").notNull().default("planned"),
  loadId: integer("load_id"),
  notes: text("notes"),
  // This trip's pay rate ($/mi). Defaults to the standing $0.55/mi —
  // the create action substitutes the driver's saved company CPM when
  // they have one and no explicit rate was given.
  payRate: real("pay_rate").notNull().default(0.55),
  // This trip's pay basis (migration 0043): "cpm" (payRate $/mi) or
  // "percent" (payPercent % of the linked load's pay). Inherits the
  // driver's Settings basis at create time when none is given.
  payBasis: text("pay_basis").notNull().default("cpm"),
  payPercent: real("pay_percent"),
  // Additional charges for this trip (migration 0042): flat extra pay
  // added on top of mileage pay when the sheet saves (detention,
  // layover, extra stops…), with the driver's note on what it's for.
  extraCharges: real("extra_charges").notNull().default(0),
  extraChargesNote: text("extra_charges_note"),
  // JSON: ordered stop labels for this trip (its own multi-stop plan).
  stopsJson: text("stops_json").notNull().default("[]"),
  // Short route summary label once a route is planned for this trip.
  routeLabel: text("route_label"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  completedTripId: integer("completed_trip_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Unified in-app Points ledger (SM Points — locked design, x 2026-10-23;
// conversion terms re-denominated by Option C, x 2026-10-26).
// Points are NOT a token and are never sendable or swappable between
// users. They are earned only from GPS-verified events through the daily
// task table (daily table v2, rewards rework 2026-10-26 — a perfect
// paid day pays exactly 500: briefing 25 · pre-trip DVIR 50 · post-trip
// DVIR 25 · trip sealed 120 · on-time POD seal 165 · clean driving day
// 75 · first confirmed intel of the day 35 · fuel stop logged 10 ·
// debrief reviewed 20; the free tier earns half on sealed work only —
// trip 60 / POD 82 — and nothing for fuel_stop), the +200 clean-week
// streak bonus, rank-season milestones, and SEALED MILES
// (owner-approved 2026-10-26): 1 point per 2.5 miles on the sealed
// trip record (0.4 pts/mi paid tier, half rate free tier), accrued
// at trip seal OUTSIDE the daily cap under monthly ceilings of
// 8,000 pts (paid) / 4,000 pts (free) — see server/src/sealedMiles.ts.
// MILES-ONLY 2x COHORT (2026-10-27): owner-operator Gold/Diamond and
// Fleet owners in paid_active standing earn sealed miles at
// 0.8 pts/mi under a 16,000 pts/month ceiling — see
// server/src/earningClass.ts. Miles only: the daily table, the 500
// cap, credits, referrals, and the +15 receipt bonus never double.
// The earner's ONE exit is conversion to $STONER under the
// anchored terms: each 1,000-pt block carries $0.25 of value, paid in
// $STONER at the live market price when the conversion pays (10,000-pt
// minimum balance, 1,000-pt blocks, 100,000 pts/month cap, paid from the
// Earning Pool only — see points_conversions). Conversion execution
// stays gated OFF until the Nov 20 launch + the owner's separate
// on-chain go-live word. Every row is also written into the hash chain.
// Balance = sum(amount) per username.
// RETENTION (owner clause A2b, 2026-10-26): the balance never expires,
// is never forfeited for staying on the free Basic tier, and is never
// wiped by a season reset or any other rollover — there is no expiry
// field on this table and no rollover path writes to it; the balance
// computation (pointsBalanceFromLedger in pointsRetention.ts) takes
// no date/season/month/tier input. CONVERSION LOCK (clause A2c,
// 2026-10-26, superseding the A2b parity draft): while free, a driver
// cannot convert points or cash out at all — both are paying-tier
// gated (moneyExitRefusal / planConversionRequest in
// accountStanding.ts, extended by A2d/A2e/A2f) and the balance
// simply keeps stacking; on
// upgrade to any paying tier the retained balance converts under the
// normal rules (see points_conversions).
export const pointsLog = sqliteTable("points_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull(), // daily_* tasks | daily_fuel_receipt_bonus (+15 receipt bonus, fuelReceiptBonus.ts) | clean_streak | sealed_miles | rank_milestone | gift_in | gift_out | conversion | signup | subscription | renewal | referral | referral_milestone | clawback
  refKey: text("ref_key"), // dedupe key for automatic awards
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// SM Points → $STONER conversion requests (Option C anchored terms,
// x 2026-10-26 — supersedes the 2026-10-23 token-fixed rate): each
// 1,000-point block carries $0.25 of value (anchor_usd, fixed at
// request time); at payout the driver receives anchor_usd ÷ the live
// $STONER price in tokens (price_usd records the price actually used;
// stoner_amount is the FINAL token amount actually paid — 0 while
// queued). Converted in 1,000-point blocks, only from a balance of at
// least 10,000 points, capped at 100,000 points per driver per
// calendar month. Conversions pay from the EARNING POOL only — a
// request the pool cannot cover stays "queued" (honest queue, never
// minted, never an unfunded promise) until the pool covers it, and
// with no live price the payout path pays NOTHING (fail closed —
// never a guessed price). Points are deducted from the ledger only
// when a conversion actually pays. Legacy rows (anchor_usd NULL) keep
// their token-denominated stoner_amount and pay it as before.
// Execution is gated by admin_settings.points_conversion_live (owner's
// go-live switch — stays off until the Nov 20 launch + separate on-chain
// go-live word); while gated, requests are refused with the gate shown.
export const pointsConversions = sqliteTable("points_conversions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  points: integer("points").notNull(),
  stonerAmount: real("stoner_amount").notNull(),
  // Option C (migration 0054): total USD value of the request under
  // the anchor; NULL on legacy token-denominated rows.
  anchorUsd: real("anchor_usd"),
  // The live price actually used at payout; NULL while queued and on
  // legacy rows.
  priceUsd: real("price_usd"),
  // SEALED MILES attribution (migration 0058, owner-approved
  // 2026-10-26): the portion of this request attributed to
  // sealed-miles points at request time — whole 1,000-point blocks
  // only, never more than the driver's unconverted miles balance
  // (miles awards − miles portions of conversions already paid or
  // queued). Conversions spend task-earned points FIRST: the task
  // portion (points − miles_points) pays in the first Earning Pool
  // queue phase, welcome/yearly credits pay second, and the miles
  // portion pays LAST. Points leave the driver's ledger only as each
  // portion pays; task_paid_at / miles_paid_at stamp each portion's
  // payment, and the row completes (status "paid", paid_at set) only
  // when BOTH portions have paid. Legacy rows have miles_points 0 —
  // their whole amount is the task portion.
  milesPoints: integer("miles_points").notNull().default(0),
  taskPaidAt: integer("task_paid_at", { mode: "timestamp_ms" }),
  milesPaidAt: integer("miles_paid_at", { mode: "timestamp_ms" }),
  // queued (waiting on the Earning Pool — possibly part-paid by
  // portion) | paid (both portions paid out)
  status: text("status").notNull().default("queued"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
});

// AI driver learning control: patterns the driver removed from the learned
// model, plus pause/reset state. Patterns themselves are computed from the
// driver's own records (trips, loads, chain, duty) — nothing is stored or
// shared anywhere else.
export const learnedExclusions = sqliteTable("learned_exclusions", {
  patternKey: text("pattern_key").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const learningState = sqliteTable("learning_state", {
  id: integer("id").primaryKey(),
  // OPT-IN invariant (x's lock, 2026-10-22): the storage default is
  // PAUSED. A row created by any writer that omits the flag must
  // read as OFF — before migration 0091 the default was false
  // (unpaused), so an insert relying on the default silently
  // switched learning ON, bypassing the driver's opt-in and the
  // Diamond gate. Unpaused may only ever be written explicitly,
  // by the Diamond-gated setLearningPaused (learningState.ts).
  paused: integer("paused", { mode: "boolean" }).notNull().default(true),
  resetAt: integer("reset_at", { mode: "timestamp_ms" }),
});

// Tamper-evident hash chain. Every trip event (start, state-line crossing,
// per-state miles/pay, completion) and every load save/update/delete appends
// one row: hash = SHA-256(prev_hash | event | payload). Editing or deleting
// any historical row breaks every later link, which the verify action
// detects. This is a LOCAL integrity chain only — nothing is posted to any
// blockchain.
export const chainLog = sqliteTable("chain_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  refKind: text("ref_kind").notNull(), // "trip" | "load"
  refId: integer("ref_id"), // trips.id / loads.id once known
  sessionId: text("session_id"), // live-trip session, linked to a trip on save
  event: text("event").notNull(),
  payload: text("payload").notNull(), // canonical JSON the hash covers
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Driver road-intel reports dropped at a GPS position. A GPS-confirmed
// report earns SM Points under the locked daily table (first confirmed
// intel of the day, +50) — points are not tokens and never move as money.
export const intelReports = sqliteTable("intel_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // weigh_open | weigh_closed | parking_open | parking_full | road_closed | hazard | scale_line
  note: text("note"),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  points: integer("points").notNull().default(10),
  // Who dropped the report (migration 0094) — the creator identity
  // the "Not here" correction reads (a creator marking their own
  // spot deletes it outright). Null on reports filed before this
  // column existed: those spots have no known creator and can only
  // be hidden per-driver or retired by two independent marks.
  reporter: text("reporter"),
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Weigh-station crowd-sourced status (migration 0092, x's order
// 2026-11-02). Stations themselves are OpenStreetMap POIs discovered
// client-side (hazard layer, id "weigh-<osm node id>"); this store is
// keyed by that stable station id. weigh_station_status holds the
// CURRENT status per station (latest driver report wins);
// weigh_station_reports is the append-only report log behind it.
// A status older than 4 hours renders as unknown again (staleness
// lives in weighStation.ts, never in stored data). Points ride the
// existing road-intel daily award and only for GPS-verified reports
// (the reporter's own GPS inside the station's approach zone).
export const weighStationStatus = sqliteTable("weigh_station_status", {
  stationId: text("station_id").primaryKey(),
  stationName: text("station_name").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  status: text("status").notNull(), // open | closed
  reporter: text("reporter").notNull(),
  reportCount: integer("report_count").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Driver-reported weigh stations (migration 0093, x's follow-up
// order 2026-11-02: "if station isn't on the map can we make a easy
// way to update it's a station here n open"). A driver standing at a
// station missing from the OpenStreetMap data adds it in two taps
// (Station here → OPEN / CLOSED); the station is created at the
// driver's GPS position captured at tap time and lives in the SAME
// universe the prompt system reads: its crowd status rides
// weigh_station_status / weigh_station_reports under its
// "driver-<uuid>" id like any OSM station, under the same freshness
// and staleness rules. This row is the station's EXISTENCE record —
// it persists after the status goes stale at 4 hours — and carries
// the reporter + timestamp the displays show ("Driver-reported —
// added by @name").
export const driverWeighStations = sqliteTable("driver_weigh_stations", {
  stationId: text("station_id").primaryKey(),
  stationName: text("station_name").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  reporter: text("reporter").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Driver-reported construction work zones (migration 0106, x's order
// 2026-11-08). One tap on the Drive screen / Cab Mode Road alerts
// drops a zone at the driver's GPS position. Lifecycle (pure rules in
// server/src/workZone.ts): a zone lives 12 hours from its last
// confirmation, then expires; "Still there" from a driver at the zone
// extends it another 12 hours; "Gone" retires it — immediately from
// the reporter, or once a second independent driver says gone.
// Official DOT zones are NEVER stored here: they are read live from
// the state's published WZDx feed (server/src/wzdx.ts) and merged at
// display time, labelled "DOT reported" — this table is driver truth
// only, always labelled "Driver-reported".
export const workZones = sqliteTable("work_zones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  note: text("note"),
  reporter: text("reporter"),
  confirmCount: integer("confirm_count").notNull().default(0),
  goneCount: integer("gone_count").notNull().default(0),
  status: text("status").notNull().default("active"), // active | retired
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  lastConfirmedAt: integer("last_confirmed_at", { mode: "timestamp_ms" }),
});

// Driver-reported road hazards (migration 0107, x's order 2026-11-08:
// "Build all five"). The hazard extension of the work-zone system:
// three quick types (traffic stopped, debris in road, vehicle on
// shoulder), one tap at the driver's GPS position, shown to other
// drivers as "Driver-reported" with age. Lifecycle (pure rules in
// server/src/hazardReport.ts): a hazard lives 2 HOURS from its last
// confirmation, then expires; "Still there" from a driver at the
// hazard extends it another 2 hours; "Gone" retires it — immediately
// from the reporter, or once a second independent driver says gone.
export const hazardReports = sqliteTable("hazard_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // traffic_stopped | debris | vehicle_shoulder
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  note: text("note"),
  reporter: text("reporter"),
  confirmCount: integer("confirm_count").notNull().default(0),
  goneCount: integer("gone_count").notNull().default(0),
  status: text("status").notNull().default("active"), // active | retired
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  lastConfirmedAt: integer("last_confirmed_at", { mode: "timestamp_ms" }),
});

export const weighStationReports = sqliteTable("weigh_station_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stationId: text("station_id").notNull(),
  stationName: text("station_name").notNull(),
  status: text("status").notNull(), // open | closed
  reporter: text("reporter").notNull(),
  // The reporting driver's own GPS position at answer time.
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  // The station's position (from the map data) the report is about.
  stationLat: real("station_lat").notNull(),
  stationLon: real("station_lon").notNull(),
  // True when the driver's GPS was inside the approach zone — only
  // verified reports earn road-intel points.
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  pointsAwarded: integer("points_awarded").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Road-intel place corrections — "✕ Not here" (migration 0094, x's
// order 2026-11-03 after a bogus weigh-station intel spot sat in a
// residential neighborhood near Government Blvd, Mobile). One
// unified place universe, keyed by a single string place id:
//   "weigh-<osm node id>"  — an OpenStreetMap weigh station (hazard)
//   "driver-<uuid>"        — a driver-reported weigh station (0093)
//   "intel-<report id>"    — a driver road-intel report, any kind
//   "explore-…"            — an Explore map place (coord-keyed id)
// road_place_corrections is the APPEND-ONLY audit trail: one row per
// mark, carrying the reporting driver, their GPS position at report
// time, and the outcome the pure rules in weighStation.ts planned
// (hidden | deleted | retired). Every mark also lands in the sealed
// hash chain (event "road_place_not_here").
// road_place_hides is the per-driver hide: the spot never renders
// and never prompts for THAT driver again, permanently, while every
// other driver still sees it — until retirement.
// road_place_retired is the for-everyone tombstone: written when the
// spot's creator marks it (reason "creator_deleted" — the underlying
// driver-owned row is deleted outright at the same moment) or when
// TWO independent drivers mark it (reason "threshold"). A retired
// place is kept here as history, never rendered, never prompted.
// No points are awarded or clawed back by any of this — road-intel
// point values are still un-locked and this flow touches none.
export const roadPlaceCorrections = sqliteTable("road_place_corrections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  placeId: text("place_id").notNull(),
  // weigh_station | driver_weigh_station | intel_report | place
  placeKind: text("place_kind").notNull(),
  reporter: text("reporter").notNull(),
  // The marking driver's own GPS position at report time.
  reporterLat: real("reporter_lat").notNull(),
  reporterLon: real("reporter_lon").notNull(),
  // hidden | deleted | retired — the outcome this mark produced.
  outcome: text("outcome").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const roadPlaceHides = sqliteTable("road_place_hides", {
  placeId: text("place_id").notNull(),
  username: text("username").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const roadPlaceRetired = sqliteTable("road_place_retired", {
  placeId: text("place_id").primaryKey(),
  placeKind: text("place_kind").notNull(),
  // creator_deleted | threshold
  reason: text("reason").notNull(),
  correctionCount: integer("correction_count").notNull().default(0),
  retiredAt: integer("retired_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Company Chat. Channels (Dispatch / Drivers / Announcements) are created
// lazily on first list; groups are driver-created with members by username.
// This build is single-user staging: groups, names, and history persist in
// the data model so they carry into the multi-driver release.
export const chatGroups = sqliteTable("chat_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("group"), // "channel" | "group" | "dm" | "company" | "open" (the one STONEMILES Open Chat room for all drivers)
  createdBy: text("created_by").notNull().default("driver"),
  // Set when the group belongs to a company (Company chat / Owner & All
  // Drivers / owner-created company groups).
  companyId: integer("company_id"),
  pinMessageId: integer("pin_message_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chatMembers = sqliteTable("chat_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull(),
  username: text("username").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull(),
  sender: text("sender").notNull(),
  kind: text("kind").notNull().default("text"), // text | load | route | location
  body: text("body").notNull(),
  payload: text("payload"), // JSON summary card for load/route/location shares
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chatReads = sqliteTable("chat_reads", {
  groupId: integer("group_id").primaryKey(),
  lastReadId: integer("last_read_id").notNull().default(0),
});

export const chatBlocks = sqliteTable("chat_blocks", {
  username: text("username").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chatReports = sqliteTable("chat_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id").notNull(),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Social layer: profiles, follows, and reports. Directory entries are the
// driver's own profile plus people the driver has added or met in groups —
// accounts fully activate with the app-store release. No location data is
// ever stored on a social profile.
export const socialUsers = sqliteTable("social_users", {
  username: text("username").primaryKey(),
  displayName: text("display_name"),
  bio: text("bio"),
  company: text("company"),
  truckInfo: text("truck_info"),
  homeCity: text("home_city"),
  homeState: text("home_state"),
  // Carrier contact phone (migration 0082): the phone number the
  // driver/carrier adds to their OWN profile for en-route
  // communication. It is NOT public profile data — getUserProfile
  // returns it only to the owner themselves, and the only other
  // readers are the shipper/broker portal shapes, which surface it
  // solely on a load that THIS carrier has already claimed (see
  // toShipperLoad / toBrokerLoad). Null = not on file; the portals
  // say so plainly and never invent one. No per-carrier phone field
  // existed before this column: company_setup.contact_phone is a
  // fleet company's office phone and the portal loads' contact_phone
  // is the shipper-side per-load contact — neither is the carrier's
  // own number, so this is the one home for it, not a duplicate.
  contactPhone: text("contact_phone"),
  // Contact + carrier credentials (migration 0083): every role —
  // carrier, driver, owner-operator, fleet owner — adds these to
  // their OWN profile. Privacy split, by design:
  //  - contactEmail is PRIVATE exactly like contactPhone: returned
  //    only to the owner in getUserProfile, and to a shipper/broker
  //    only on a load this carrier has claimed (portal shapes).
  //  - mcNumber / dotNumber are PUBLIC business information (the
  //    same standing rule as the company verification card): shown
  //    on the public profile and used to build the official FMCSA
  //    SAFER Web Company Snapshot link (server/src/safer.ts) — a
  //    LINK to the official record, never a stored or computed
  //    safety score.
  //  - TWIC is stored as a holding flag + expiry date ONLY — never
  //    the card number (a personal credential number has no business
  //    in a profile row). endorsements is a comma-separated list of
  //    CDL endorsement keys validated against the federal list in
  //    safer.ts (hazmat, tanker, doubles_triples, hazmat_tanker,
  //    passenger, school_bus); both are public credential facts a
  //    broker/shipper vets on, shown on the profile.
  contactEmail: text("contact_email"),
  mcNumber: text("mc_number"),
  dotNumber: text("dot_number"),
  twicHas: integer("twic_has", { mode: "boolean" }).notNull().default(false),
  twicExpires: text("twic_expires"), // YYYY-MM-DD, driver-entered
  endorsements: text("endorsements").notNull().default(""),
  avatarBlobKey: text("avatar_blob_key"),
  avatarMime: text("avatar_mime"),
  dmPolicy: text("dm_policy").notNull().default("everyone"), // everyone | following | nobody
  groupPolicy: text("group_policy").notNull().default("everyone"),
  showReputation: integer("show_reputation", { mode: "boolean" })
    .notNull()
    .default(false),
  // Miles panel privacy (Pass 4): the driver chooses whether the
  // today/week/month/year miles panel shows on their public profile.
  // Default ON (miles are the profile's headline stat); turning it off
  // hides the panel publicly — the board and other profiles never
  // override it. The driver always sees their own numbers.
  showMilesPanel: integer("show_miles_panel", { mode: "boolean" })
    .notNull()
    .default(true),
  // Featured badge (migration 0061): the ONE earned badge the driver
  // chose to feature — "referral" | "all_time_best" | "season_rank".
  // Null = no choice (the default display order rules). The choice is
  // validated against the driver's earned set on write AND on read
  // (server/src/profileBadges.ts); a stale/unearned value falls back
  // to the default order silently.
  featuredBadge: text("featured_badge"),
  // My Desk solo opt-in (migration 0090, round 3): TRUE once this
  // profile has opened My Desk as a SOLO dispatcher — the act that
  // makes them a dispatcher in the system. A poster account whose
  // owner carries this flag is a DISPATCHER POSTER: its public-board
  // loads accrue the platform's 2% at sealed delivery exactly like a
  // dispatch-only company's (platformFee.ts). Shipper/broker direct
  // posters who never open a dispatcher desk never carry the flag
  // and never accrue. The flag is set only by openMyDesk (sealed);
  // nothing else writes it.
  dispatcherPoster: integer("dispatcher_poster", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const follows = sqliteTable("follows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  follower: text("follower").notNull(),
  followee: text("followee").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const socialReports = sqliteTable("social_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Companies: exactly one structure per company — Owner, Dispatch, Driver.
// Drivers join only with a driver code the owner issued; joining auto-adds
// them to the company's two default chats (Company chat + Owner & All
// Drivers), which are chat_groups rows with companyId set.
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  ownerUsername: text("owner_username").notNull(),
  // Account type (migration 0087): "fleet" (runs its own trucks —
  // every company before this migration) or "dispatch" (a dispatch
  // company: owns no trucks, dispatches drivers for client fleets —
  // RUGGS LOGISTICS is the archetype). Same seat model either way;
  // kind decides the desk surface (client fleets + review-queue
  // public posting) — see dispatchCompany.ts for the pure rules.
  // PLAN STATE (x, 2026-11-02 round 2): a FLEET is born on the
  // Fleet/Owner plan (creation transitions the creator's recorded
  // plan). A DISPATCH company is born as a PLAIN PROFILE — no plan
  // transition, no owner badge; its Fleet Owner plan activates only
  // when the owner turns it on to add drivers of their own (the
  // activation is a recorded plan transition anchored to this
  // company in the sealed chain — see activateDispatchFleetPlan).
  kind: text("kind").notNull().default("fleet"), // fleet | dispatch
  // Dispatcher fee % (migration 0088, x 2026-11-02): the dispatch
  // company's OWN fee for loads it posts — set by its owner, capped
  // at 20 server-side, snapshotted onto each board row at post /
  // release time and shown to the claiming carrier BEFORE they
  // claim. Null = unset, which means 0% (no fee). Records only: the
  // app moves no money for it; settlement happens outside the app.
  // (Distinct from the RUGGS LLC house dispatch fee in
  // dispatchFee.ts, which is invoiced to the carrier at sealed
  // delivery under its own locked rules.)
  dispatcherFeePct: real("dispatcher_fee_pct"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const companyMembers = sqliteTable("company_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  username: text("username").notNull(),
  role: text("role").notNull().default("driver"), // owner | dispatch | driver
  // Security Pack 2: one-tap Cut Off Access flips this — the member's
  // login is disabled and all their sessions revoked, sealed as an event.
  loginDisabled: integer("login_disabled", { mode: "boolean" }).notNull().default(false),
  autoLogOverride: text("auto_log_override"), // null = company default | "on" | "off"
  // Dispatch companies only (migration 0087): the client fleet this
  // member is stamped to inside the dispatch company (the code they
  // redeemed named it, or the desk assigned it later). Null = the
  // member belongs to the company directly — and always null in fleet
  // companies, which have no client fleets. The stamp is the consent
  // record: set at join, changeable by the desk, ended by leaving /
  // removal like every membership.
  clientFleetId: integer("client_fleet_id"),
  joinedAt: integer("joined_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Client fleets (migration 0087): a dispatch company's clients — the
// carriers/shippers it dispatches for. A LIGHTWEIGHT record only:
// name, contact, MC/DOT when the client has them. A client fleet is
// NOT an account — it holds no login, no wallet, no money; it exists
// so the desk can stamp its drivers to the client they run for and
// keep each client's work inside the dispatch company's own walls.
// A dispatch company sees only its own client fleets; nothing about
// them is visible to any other company, fleet accounts included.
export const clientFleets = sqliteTable("client_fleets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // The dispatch company that owns this client record.
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  mcNumber: text("mc_number"),
  usdotNumber: text("usdot_number"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Owner onboarding: company identity + authority details. Legal name, MC,
// USDOT and business address are PUBLIC business information (brokers and
// drivers verify carriers by them) and are shown openly as the company
// verification card. The EIN is business paperwork data, shared through
// document flows. A company stays "setup incomplete" — and cannot issue
// driver codes — until the required fields and documents are in.
export const companySetup = sqliteTable("company_setup", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  legalName: text("legal_name"),
  dba: text("dba"),
  address: text("address"),
  ein: text("ein"),
  mcNumber: text("mc_number"),
  usdotNumber: text("usdot_number"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  fleetSize: integer("fleet_size"),
  complete: integer("complete", { mode: "boolean" }).notNull().default(false),
  // Owner option: automatic daily start/stop logs per driver, company-wide
  // default with a per-driver override on company_members.
  autoLogEnabled: integer("auto_log_enabled", { mode: "boolean" }).notNull().default(false),
  autoLogNotify: text("auto_log_notify").notNull().default("immediate"), // immediate | digest
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Paperwork vault: company tax/authority documents (W-9, MC/DOT authority,
// insurance) and per-driver W-9s, stored as encrypted-at-rest blobs under
// owner control. Documents are files, never rendered as data fields; a
// driver's personal identifiers stay inside the document — lists show the
// document's name/kind/status only.
export const companyDocs = sqliteTable("company_docs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  // Whose document it is: the company itself, or a driver's username.
  subjectUsername: text("subject_username").notNull(),
  kind: text("kind").notNull(), // w9 | authority | insurance | driver_w9
  filename: text("filename").notNull(),
  mime: text("mime"),
  blobKey: text("blob_key").notNull(),
  status: text("status").notNull().default("uploaded"), // uploaded | verified
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Company Owner Auto Log: one sealed daily log per driver. Opened by the
// morning pretrip + start clock, closed by the stop clock (or auto-closed,
// labelled, when the driver never stops it). Contains WORK data only —
// miles, fuel, HOS, pretrip, loads — never anything from the wallet
// domain, which is not connected to the company system at all.
export const dailyLogs = sqliteTable("daily_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id"),
  username: text("username").notNull(),
  logDate: text("log_date").notNull(), // YYYY-MM-DD (driver-local at open)
  status: text("status").notNull().default("open"), // open | closed | auto_closed
  openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  startMiles: real("start_miles"),
  startMilesSource: text("start_miles_source"), // "ELD odometer" | "GPS"
  fuelStart: text("fuel_start"),
  hosStart: text("hos_start"), // JSON snapshot of the four clocks
  pretrip: text("pretrip"), // JSON: { result, defects: [{item, note, critical}] }
  finishMiles: real("finish_miles"),
  totalMiles: real("total_miles"),
  fuelUsage: text("fuel_usage"),
  hosEnd: text("hos_end"),
  loadsDelivered: integer("loads_delivered").notNull().default(0),
  detentionText: text("detention_text"),
  criticalDefect: integer("critical_defect", { mode: "boolean" }).notNull().default(false),
});

// ---- Beta access ------------------------------------------------------------
// Issued beta invite codes. The owner/master code is reusable and unlocks
// an owner account; driver codes are single-use. Codes are seeded exactly
// as issued (migration 0013) and every lifecycle event (issue, redeem,
// revoke, regenerate) is also written into the sealed hash chain.
export const betaCodes = sqliteTable("beta_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  kind: text("kind").notNull().default("driver"), // owner | driver
  singleUse: integer("single_use", { mode: "boolean" }).notNull().default(true),
  usedBy: text("used_by"),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Single-row beta gate state (id = 1): whether this install has been
// unlocked, and with which kind of code.
export const betaAccess = sqliteTable("beta_access", {
  id: integer("id").primaryKey(),
  unlocked: integer("unlocked", { mode: "boolean" }).notNull().default(false),
  accountKind: text("account_kind"), // owner | driver
  codeUsed: text("code_used"),
  unlockedAt: integer("unlocked_at", { mode: "timestamp_ms" }),
});

// ---- Referrals + reward wallet ---------------------------------------------
// Every user gets a personal referral code (minted lazily, shown on the
// profile and in the wallet). Signing up with someone else's code creates
// exactly one referral link; self-referral is blocked.
export const referralCodes = sqliteTable("referral_codes", {
  username: text("username").primaryKey(),
  code: text("code").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const referralLinks = sqliteTable("referral_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  referrerUsername: text("referrer_username").notNull(),
  referredUsername: text("referred_username").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One referral reward per referred user, created when that user pays their
// FIRST subscription. Status is "queued" until the reward wallet actually
// holds enough $STONER to pay it — rewards never pay what isn't held.
export const referralRewards = sqliteTable("referral_rewards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  referrerUsername: text("referrer_username").notNull(),
  referredUsername: text("referred_username").notNull(),
  amountStoner: real("amount_stoner").notNull(),
  status: text("status").notNull().default("queued"), // queued | paid
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
});

// Referral LEVELS milestone state (locked 2026-10-25). One row per
// (referrer, level) for the levels that carry a one-time milestone
// bonus — Dispatcher (5 active referrals, +1,000 SM Points), Fleet
// Builder (15, +2,500), Road Captain (40, +5,000). `paid` is the
// persistent per-level milestone-paid flag: once true it NEVER goes
// back to false, so a milestone can never pay twice — if a refund
// drops the active count back below the threshold, the bonus is
// reversed (a clawback points row) and `reversed` flips true, but
// `paid` stays true and a later re-cross pays nothing again.
export const referralMilestones = sqliteTable("referral_milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  referrerUsername: text("referrer_username").notNull(),
  levelKey: text("level_key").notNull(), // dispatcher | fleet_builder | road_captain
  threshold: integer("threshold").notNull(),
  bonusPoints: integer("bonus_points").notNull(),
  paid: integer("paid", { mode: "boolean" }).notNull().default(false),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  reversed: integer("reversed", { mode: "boolean" }).notNull().default(false),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Reward wallet ledger (amounts in $STONER, signed: in positive, out
// negative). Funded on the alt-token subscription path — of each alt-token
// dollar's 90% team share, 10% routes here (net 81¢ team / 9¢ reward
// wallet / 10¢ auto-buy $STONER and burn). Pays referral rewards and
// team-run $STONER rewards/giveaways. Balance = sum(amount_stoner); every
// movement is also written into the sealed hash chain.
export const rewardWalletLedger = sqliteTable("reward_wallet_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // alt_token_in | referral_payout | team_reward
  amountStoner: real("amount_stoner").notNull(),
  username: text("username"), // payout recipient, when the row is a payout
  // Idempotency key for payout rows (migration 0050): e.g.
  // "referral_reward:41" / "giveaway_vesting:7". UNIQUE — a payout for
  // the same source row can be recorded exactly once, so a double-run
  // or concurrent run of a payout processor can never double-pay.
  // Null on non-payout rows and on rows written before the key existed.
  refKey: text("ref_key").unique(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Single-row app settings (id = 1): the driver's own Settings screen —
// appearance, font size, driving alert preferences, and per-type
// notification switches. Created lazily on first save; defaults live in
// the actions layer until the driver changes something. These are the
// user's preferences only — no staged/money feature reads this table.
export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  appearance: text("appearance").notNull().default("dark"), // dark | light | system
  fontSize: text("font_size").notNull().default("standard"), // standard | large | xlarge
  units: text("units").notNull().default("mi"), // mi | km
  overspeedThresholdMph: integer("overspeed_threshold_mph").notNull().default(5),
  voiceAlerts: integer("voice_alerts", { mode: "boolean" }).notNull().default(true),
  bannerAlerts: integer("banner_alerts", { mode: "boolean" }).notNull().default(true),
  notifyHos: integer("notify_hos", { mode: "boolean" }).notNull().default(true),
  notifyDelivery: integer("notify_delivery", { mode: "boolean" }).notNull().default(true),
  notifyChat: integer("notify_chat", { mode: "boolean" }).notNull().default(true),
  notifyOwnerLog: integer("notify_owner_log", { mode: "boolean" }).notNull().default(true),
  // App language: "en" (source) | "es" | "pt" | "ru" | "uk" —
  // the catalogue + fallback live in client/src/i18n.ts.
  language: text("language").notNull().default("en"),
  // Map display preferences (migration 0060): what the map draws.
  // Defaults = the map exactly as it shipped before customization
  // existed (everything on, streets base) — see server/src/mapPrefs.ts.
  mapBaseStyle: text("map_base_style").notNull().default("streets"), // streets | satellite | hybrid
  mapShowFuel: integer("map_show_fuel", { mode: "boolean" }).notNull().default(true),
  mapShowParking: integer("map_show_parking", { mode: "boolean" }).notNull().default(true),
  mapShowHazards: integer("map_show_hazards", { mode: "boolean" }).notNull().default(true),
  mapShowIntel: integer("map_show_intel", { mode: "boolean" }).notNull().default(true),
  mapShowRoute: integer("map_show_route", { mode: "boolean" }).notNull().default(true),
  mapShowSpeed: integer("map_show_speed", { mode: "boolean" }).notNull().default(true),
  mapShowLabels: integer("map_show_labels", { mode: "boolean" }).notNull().default(true),
  // Traffic notes display toggle (migration 0062): display-only — gates
  // the TomTom traffic annotations on route cards + the scan-ahead
  // status, never any fetching or safety behavior. Default on.
  mapShowTrafficNotes: integer("map_show_traffic_notes", { mode: "boolean" }).notNull().default(true),
  // GPS day / night mode (migration 0081): auto | day | night | off.
  // Display-only — restyles the Streets base map (day true-color /
  // dark night basemap); default "auto" follows the sun at the
  // truck's position, "off" disables it entirely.
  mapDayNightMode: text("map_day_night_mode").notNull().default("auto"),
  // Route weather (migration 0085): the NWS radar overlay switch
  // (display-only, default OFF — radar is an overlay the driver
  // turns on, never a default wash over the map) and the driver's
  // own wind-gust decision threshold in mph (flatbed-relevant:
  // gusts at/above it are decision-grade and SI surfaces them).
  mapShowRadar: integer("map_show_radar", { mode: "boolean" }).notNull().default(false),
  weatherGustThresholdMph: integer("weather_gust_threshold_mph").notNull().default(35),
  // Weigh-station approach prompts (migration 0092): while a trip is
  // live, approaching a weigh station whose status is unknown or
  // stale pops the one-tap OPEN / CLOSED prompt. Default ON; the
  // driver can turn prompts off in Settings → Driving.
  weighPrompts: integer("weigh_prompts", { mode: "boolean" }).notNull().default(true),
  // Drive-screen overlay customization (migration 0095, Repair 5):
  // per-driver VISIBILITY + TRANSPARENCY ONLY for the floating
  // elements on the Drive/GPS screen — weather chip, big prompt
  // cards, ETA pill, and the traffic legend chip (DEFAULT OFF: the
  // 2026-11-03 chip-removal order is the standard layout; this
  // switch is the only way the legend ever appears). driveGlassLevel
  // is the see-through level: low | med | high (med = standard).
  // None of these govern any behavior — prompt timers, guidance,
  // and alerts never consult them. See server/src/mapPrefs.ts.
  driveShowWeather: integer("drive_show_weather", { mode: "boolean" }).notNull().default(true),
  driveShowBigPrompts: integer("drive_show_big_prompts", { mode: "boolean" }).notNull().default(true),
  driveShowTrafficLegend: integer("drive_show_traffic_legend", { mode: "boolean" }).notNull().default(false),
  driveShowEtaPill: integer("drive_show_eta_pill", { mode: "boolean" }).notNull().default(true),
  driveGlassLevel: text("drive_glass_level").notNull().default("med"), // low | med | high
  // Enhanced map view (migration 0100): the satellite base styles +
  // the tilted driving camera as ONE removable feature (x's order
  // 2026-11-06, "with optional removal"). mapEnhancedView OFF removes
  // the feature entirely — the style choice collapses to Streets, the
  // tilt control leaves the map, and the camera is forced flat — the
  // plain map exactly as it shipped before satellite/tilt existed.
  // mapTiltMode is the driver's camera choice while enhanced is on:
  // auto (Go tilted / Explore flat, as shipped) | flat | tilted.
  // Display-only — routing, alerts, and data never consult either.
  mapEnhancedView: integer("map_enhanced_view", { mode: "boolean" }).notNull().default(true),
  mapTiltMode: text("map_tilt_mode").notNull().default("auto"), // auto | flat | tilted
  // Android Auto / Car Mode (migration 0104): the driver's car-display
  // preferences. carModeEnabled is the master switch for the glanceable
  // car display (the surface the Android Auto build projects);
  // carModeAutoLaunch opens it when guidance starts; carVoicePrompts
  // keeps spoken directions running on the car display; carShowHos
  // puts the drive-clock tile on it. Display/preference only — the
  // native Android Auto projection ships with the Play Store build.
  // Hill grade alerts (migration 0105): spoken + banner warnings for
  // sustained grades ≥4% derived from the route's stored Valhalla
  // elevation — advance call, crest call, live grade readout beside
  // the speed bubble. A core safety feature on every tier; default ON;
  // the driver can turn it off here in Settings → Driving.
  hillGradeAlerts: integer("hill_grade_alerts", { mode: "boolean" }).notNull().default(true),
  // Winter & weather alerts (migration 0107): the Settings → Driving
  // switch for the severe-weather-on-route calls, chain alerts, and
  // snow-depth alerts (client/src/winterWeather.ts; free National
  // Weather Service data). A core safety feature on every tier;
  // default ON.
  winterWeatherAlerts: integer("winter_weather_alerts", { mode: "boolean" }).notNull().default(true),
  // Traffic lights layer (migration 0106): the Layers & display /
  // Settings → Driving switch for the OpenStreetMap traffic-signal
  // LOCATIONS layer. Locations only — no signal phase/timing data
  // exists in the source and none is ever shown. Default ON.
  mapShowSignals: integer("map_show_signals", { mode: "boolean" }).notNull().default(true),
  carModeEnabled: integer("car_mode_enabled", { mode: "boolean" }).notNull().default(false),
  carModeAutoLaunch: integer("car_mode_auto_launch", { mode: "boolean" }).notNull().default(true),
  carVoicePrompts: integer("car_voice_prompts", { mode: "boolean" }).notNull().default(true),
  carShowHos: integer("car_show_hos", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Security hardening (migration 0015) -----------------------------------
// Append-only security audit trail: PIN changes, failed unlocks, lockouts,
// EIN reveals, payment-intent creation, data wipes. Detail is a short
// human label only — never a PIN, card number, seed phrase, or full EIN.
export const securityEvents = sqliteTable("security_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  event: text("event").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// PIN brute-force guard (single row, id = 1): consecutive failed unlocks
// and the lockout deadline. 5 failures lock unlock attempts for 15 min.
export const pinGuard = sqliteTable("pin_guard", {
  id: integer("id").primaryKey(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Payment ledger — STAGING. Records payment *intents* only: method,
// amount, plan, and an idempotency key so a retried checkout can never
// double-charge. No card number, expiry, CVC, bank credential, or wallet
// key is ever a column here — at go-live the licensed processor tokenizes
// the card in its own hosted fields and this app stores only the
// processor's token + last 4 (neither exists in staging).
export const paymentLedger = sqliteTable("payment_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  method: text("method").notNull(), // card | stoner | other_token
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("requires_provider"), // requires_provider | paid | reversed
  plan: text("plan"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Single-row admin settings (id = 1).
export const adminSettings = sqliteTable("admin_settings", {
  id: integer("id").primaryKey(),
  // $STONER paid to a referrer when their referred user pays a first
  // subscription. Owner/admin-configurable; 100 is the shipped default.
  referralRewardStoner: real("referral_reward_stoner").notNull().default(100),
  // RETIRED (Option C, 2026-10-26): the yearly subscriber credit is
  // USD-denominated now — see yearlyCreditUsd below. This token column
  // is kept so old staging rows stay valid; nothing reads it for new
  // grants. (Pre-Option-C terms: 100 $STONER to annual subscribers.)
  yearlyCreditStoner: real("yearly_credit_stoner").notNull().default(100),
  // $STONER YEARLY SUBSCRIBER credit (owner rework, 2026-10-25;
  // Option C USD re-denomination, 2026-10-26): a $1.00 USD entitlement
  // paid in $STONER at the live price at payout, ONLY to annual
  // (yearly) subscribers — it is NOT a free-signup credit (free signups
  // earn 100 SM Points instead). Owner/admin-configurable; $1.00 is
  // the shipped default. It stays LOCKED for sending/swapping/selling
  // until the account seals its first GPS trip (anti-farm rule) — the
  // lock is tracked on the welcome_credits row (kind "yearly").
  yearlyCreditUsd: real("yearly_credit_usd").notNull().default(1),
  // RETIRED weekly-giveaway settings (the weekly activity giveaway was
  // replaced by the subscriber giveaway, 2026-10-25 — its numbers are
  // locked constants in the actions layer now). Columns kept so old
  // staging rows stay valid; nothing reads them.
  giveawayWeeklyCap: integer("giveaway_weekly_cap").notNull().default(10),
  giveawayVestPct: real("giveaway_vest_pct").notNull().default(25),
  // RETIRED (Option C, 2026-10-26): welcome credits are USD-denominated
  // now — see the *_usd columns below. These token columns are kept so
  // old staging rows stay valid; nothing reads them for new grants.
  // (Pre-Option-C terms: Gold 1,000 / Diamond 10,000 / Fleet 100,000
  // $STONER.)
  welcomeCreditGoldStoner: real("welcome_credit_gold_stoner").notNull().default(1000),
  welcomeCreditDiamondStoner: real("welcome_credit_diamond_stoner").notNull().default(10000),
  welcomeCreditOwnerStoner: real("welcome_credit_owner_stoner").notNull().default(100000),
  // Welcome credit paid to the NEW subscriber on their first paid
  // subscription, from the Earning Pool — a USD entitlement paid in
  // $STONER at the live price at payout (Option C, 2026-10-26).
  // Per-plan amounts, set by the FIRST paid plan the account ever buys
  // (Gold $1.00 / Diamond $5.00 / Fleet(Owner) $25.00 as shipped);
  // later upgrades never top it up. Owner/admin-configurable in the
  // same place as the referral amount.
  welcomeCreditGoldUsd: real("welcome_credit_gold_usd").notNull().default(1),
  welcomeCreditDiamondUsd: real("welcome_credit_diamond_usd").notNull().default(5),
  welcomeCreditOwnerUsd: real("welcome_credit_owner_usd").notNull().default(25),
  // SM Points → $STONER conversion go-live switch (owner-only). Stays 0
  // until the Nov 20 launch AND the owner's separate on-chain go-live
  // word; while 0, conversion requests are refused with the gate shown
  // and no points ever move. Same staging-gate pattern as the giveaway.
  pointsConversionLive: integer("points_conversion_live", { mode: "boolean" }).notNull().default(false),
  // USDG POOL BACKING (plan DECIDED by x, 2026-10-26 — spec:
  // usdg-pool-backing-spec-2026-10-26.md). D2: payout runs are MANUAL
  // BATCH at launch — 1 (the shipped default) means payout processors
  // execute ONLY when an admin explicitly runs a batch
  // (runPayoutBatch); automatic triggers (funding, subscription
  // events, wallet reads) never pay. Flipping to 0 is the later
  // automation decision, x's word only.
  payoutManualBatch: integer("payout_manual_batch", { mode: "boolean" }).notNull().default(true),
  // D4: 1 once the spec §8 checklist verifies AND x gives the go-live
  // word — from then the rewards backing stands 100% on-chain as USDG
  // and the depeg/coverage pause gates payout runs. Stays 0 through
  // launch: the bank-dollar fallback posture governs until then.
  usdgBackingLive: integer("usdg_backing_live", { mode: "boolean" }).notNull().default(false),
  // The USDG market price input for backing valuation (depeg rule:
  // USDG is valued at its REAL price, never assumed $1). NULL
  // pre-launch — no price input exists, and the backing assessment
  // FAILS CLOSED (payouts paused) on an unknown price whenever the
  // backing is live. Set by the owner via setPoolBackingConfig until
  // a live USDG price read wires in beside liveStonerPriceUsd.
  usdgPriceUsd: real("usdg_price_usd"),
  // TEAM CONTACT EMAIL (owner, 2026-10-30, migration 0078): the
  // Stonervision team's own mailbox — stonervisionteam@gmail.com.
  // This is THE team email recorded for the Team Portal: team notices,
  // seat-invite issuance, and consent-session closeouts are addressed
  // from/for the team under this address wherever the app records a
  // team email. Separate from the owner's own account email and from
  // ruggsllc7@gmail.com (RUGGS LOGISTICS only). Transport stays staged — the
  // address is recorded and used in notice bodies/records; it does
  // not change how mail is sent.
  teamEmail: text("team_email").notNull().default("stonervisionteam@gmail.com"),
});

// One-time credits per account, ever (Option C USD entitlements,
// 2026-10-26). Two kinds:
// - "welcome": the first-subscription welcome credit (gold/diamond/owner
//   paid plan sets the USD amount), never locked for spending.
// - "yearly": the $1.00 YEARLY SUBSCRIBER credit (2026-10-25 rework —
//   no longer a free-signup credit). Only annual (yearly) subscribers
//   receive it. It shows in the wallet once granted but `locked` stays
//   1 until the account seals its first GPS trip (anti-farm: real
//   drivers unlock it with their first drive; bot farms can't cash
//   it out).
// amount_usd is the USD entitlement; amount_stoner is the FINAL token
// amount actually paid (0 while queued on anchored rows; set at payout
// from amount_usd ÷ the live price). Legacy rows (amount_usd NULL)
// keep their token-denominated amount_stoner and pay it as before.
// Status is "queued" until the Earning Pool actually holds enough
// $STONER to cover it — never an IOU. "reversed" on a refunded/
// charged-back payment (House Rule 1 clawback covers both kinds).
export const welcomeCredits = sqliteTable("welcome_credits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  amountStoner: real("amount_stoner").notNull(),
  // Option C (migration 0054): USD entitlement; NULL on legacy rows.
  amountUsd: real("amount_usd"),
  status: text("status").notNull().default("queued"), // queued | paid | reversed
  kind: text("kind").notNull().default("welcome"), // welcome | yearly
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  plan: text("plan"), // gold | diamond | owner — which first paid plan set a welcome credit's amount
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
});

// Vesting tranches for the vested welcome credits (Option C,
// 2026-10-26: vesting is by plan shape — Diamond: 25% head at first
// subscription, then the remainder in 6 monthly tranches; Fleet/Owner:
// 25% head, then the remainder in 12 monthly tranches; Gold is liquid).
// The welcome_credits row holds the FIRST tranche (the 25% head, paid
// through the normal queue); these rows hold the monthly remainder.
// amount_usd is that tranche's USD entitlement; amount_stoner is the
// FINAL token amount actually paid (0 while pending on anchored rows).
// Legacy rows (amount_usd NULL) pay their token amount as before.
// A tranche vests only while the subscription that earned it stays
// active. NON-RENEWAL (clause A2e, 2026-10-26): the lapse no longer
// returns tranches at the lapse date — the account first goes on a
// 14-day retainer (account_retainers) during which vesting clocks
// PAUSE (due dates shift by the paused span on renewal) and nothing
// pays or returns; only if the retainer expires un-renewed do pending
// tranches flip to "returned" (they were never disbursed, so nothing
// leaves the pool) and the wallet says so plainly. Giveaway prizes
// vest in giveaway_vesting instead — time-only vesting with no
// active-subscription condition. Never blended into the available
// balance.
export const welcomeVesting = sqliteTable("welcome_vesting", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  welcomeCreditId: integer("welcome_credit_id")
    .notNull()
    .references(() => welcomeCredits.id),
  plan: text("plan").notNull(), // diamond | owner — the first paid plan that set the credit
  trancheNo: integer("tranche_no").notNull(),
  totalTranches: integer("total_tranches").notNull(),
  amountStoner: real("amount_stoner").notNull(),
  // Option C (migration 0054): this tranche's USD entitlement; NULL
  // on legacy token-denominated rows.
  amountUsd: real("amount_usd"),
  dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | returned
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Non-renewal retainers (clause A2e, migration 0056, 2026-10-26). One
// row per non-renewal of a paying account: when the recorded plan
// drops from a paid plan to Basic (in staging the plan-choice flow
// stands in for the billing non-renewal event; at go-live the billing
// path posts the same transition), a retainer opens for 14 days
// (ends_at = started_at + 14 days). While a retainer is "active" the
// account is IN RETAINER: conversion + cash-out locked (clause A2d),
// the earned points balance retained in full, welcome vesting clocks
// paused. Renewal inside the window flips the row to "lifted"
// (lifted_at set; pending vesting due dates shift by the paused
// span). If the window ends un-renewed the row flips to "expired"
// (expired_at set) at the settle pass: unvested welcome tranches
// return to the Earning Pool at that moment, and the earned balance
// stays retained and locked indefinitely — reactivatable on any later
// return, no further decay, ever. At most one "active" row per
// username (enforced in notePlanTransition).
export const accountRetainers = sqliteTable("account_retainers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  plan: text("plan").notNull(), // gold | diamond | owner — the paid plan that did not renew
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("active"), // active | lifted | expired
  liftedAt: integer("lifted_at", { mode: "timestamp_ms" }),
  expiredAt: integer("expired_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Post-reactivation holds (clause A2f, migration 0057, 2026-10-26).
// Any reactivation after a non-renewal starts a 14-day hold from the
// reactivation date: conversion and both cash-out lanes stay locked
// until the hold ends, in both branches — "renewed_in_retainer" (the
// retainer lifted inside its window; nothing forfeited, vesting
// clocks resumed per A2e) and "returned_after_expiry" (the retainer
// had already expired; the earned points balance only — the unvested
// welcome credits returned at expiry do NOT come back). The account
// must stay active through the whole hold: cancelling during it
// flips the row to "cancelled" and opens a FRESH retainer cycle
// (account_retainers) from that cancellation. A hold whose end passes
// with the account still paying resolves to unlocked (the settle pass
// flips it to "completed"). At most one "active" row per username.
export const accountHolds = sqliteTable("account_holds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  retainerId: integer("retainer_id"), // the account_retainers row this reactivation closed
  branch: text("branch").notNull(), // renewed_in_retainer | returned_after_expiry
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("active"), // active | completed | cancelled
  cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Earning Pool ledger (amounts in $STONER, signed: in positive, out
// negative). The 25% "earning pool" slice of every card/$STONER
// subscription payment — the "$stoner recycling in app" pool — lands here
// at go-live billing; it pays welcome credits. Balance = sum(amount_stoner).
// Every movement is also written into the sealed hash chain.
export const earningPoolLedger = sqliteTable("earning_pool_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // sub_in | welcome_payout
  amountStoner: real("amount_stoner").notNull(),
  username: text("username"), // payout recipient, when the row is a payout
  // Idempotency key for payout rows (migration 0050): e.g.
  // "welcome_credit:12" / "welcome_vesting:5" /
  // "welcome_vesting_returned:5". UNIQUE — see reward_wallet_ledger.
  refKey: text("ref_key").unique(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Earning Pool USDG backing ledger (amounts in USDG, signed: in
// positive, out negative). Under the DECIDED USDG backing plan (x,
// 2026-10-26 — spec: usdg-pool-backing-spec-2026-10-26.md) the rewards
// slice parks as USDG in the Earning Pool wallet
// (0x4550E380182c8CdE5Fbc01004eb7DA42CF102213) instead of pre-bought
// $STONER; at payout the pool spends USDG to buy the $STONER owed.
// Rows: "slice_in_usdg" (rewards-slice receipts, recorded by the owner
// in staging; posted by the billing path at go-live), "payout_spend_usdg"
// (one per anchored payout, written only while usdg_backing_live is on),
// "sweep_out_usdg" (x's sweeps of the surplus above the D3 floor —
// floor-guarded, never automatic). Balance = sum(amount_usdg).
// This ledger is the backing's book of record in-app; the on-chain
// wallet balance is the public proof (D1). Every movement is also
// written into the sealed hash chain.
export const earningPoolBackingLedger = sqliteTable("earning_pool_backing_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // slice_in_usdg | payout_spend_usdg | sweep_out_usdg
  amountUsdg: real("amount_usdg").notNull(),
  username: text("username"), // payout recipient, when the row is a payout spend
  // Idempotency key for payout-spend rows: e.g.
  // "backing_spend:points_conversion:12" / "backing_spend:welcome_credit:12"
  // / "backing_spend:welcome_vesting:5". UNIQUE — see earning_pool_ledger.
  refKey: text("ref_key").unique(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Locker ledger (amounts in $STONER, signed: deposits positive). The ONE
// locked reserve fed by both payment paths: each subscription's 15%
// locker slice of the auto-bought $STONER lands here. It cannot be
// spent, sent, or swapped — it unlocks ONLY on x's separate go-live
// decision (no unlock date or schedule is invented). Balance =
// sum(amount_stoner); total ever locked = sum of positive deposits.
// Every deposit is sealed; the money-flow views show the balance, the
// USD value (honest pre-launch: "Value goes live at launch"), and the
// dated deposit history — every coin visible, always.
export const lockerLedger = sqliteTable("locker_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // locker_deposit | locker_unlock
  amountStoner: real("amount_stoner").notNull(),
  username: text("username"), // deposit source account, when known
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Burn ledger (amounts in $STONER, positive = destroyed). The 10% slice
// of every subscription's auto-bought $STONER is burned outright — this
// ledger records those burns so the CHIP panel's burn counter reads real
// rows. CHIP's own buyback-engine burns are NOT rows here: they come from
// the CHIP market feed once it is live (pre-launch that leg is unknown).
// Balance = sum(amount_stoner); every burn is sealed into the chain.
export const burnLedger = sqliteTable("burn_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // subscription_burn
  amountStoner: real("amount_stoner").notNull(),
  username: text("username"), // burn source account, when known
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const driverCodes = sqliteTable("driver_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  code: text("code").notNull(),
  singleUse: integer("single_use", { mode: "boolean" }).notNull().default(true),
  usedBy: text("used_by"),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  // Dispatch companies only (migration 0087): the client fleet this
  // code stamps its driver to on redemption. Null = the driver joins
  // the company directly. Validated against the code's own company at
  // redemption — a code can never stamp a driver into another
  // company's client fleet.
  clientFleetId: integer("client_fleet_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// AI activity log: every automated action the "AI runs it" layer takes,
// with its reason. The audit trail that keeps automation inspectable.
export const aiLog = sqliteTable("ai_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Saved loads. Fields come from a rate-con / load sheet the driver uploads
// (vision-extracted, then driver-confirmed) or from the manual form. Anything
// the document didn't show stays null — never filled in by the app.
export const loads = sqliteTable("loads", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  shipper: text("shipper"),
  pickupCity: text("pickup_city"),
  pickupState: text("pickup_state"),
  deliveryCity: text("delivery_city"),
  deliveryState: text("delivery_state"),
  pickupText: text("pickup_text"),
  deliveryText: text("delivery_text"),
  rate: real("rate"),
  // Loaded miles + where they came from (migration 0080): the miles
  // the load pays over. $/mi is DERIVED from these at read time
  // (rate ÷ miles, total ÷ miles) and never stored, so it can never
  // drift from the rate or the miles. milesSource: "document" (printed
  // on the rate con / read by Meca's scan), "entered" (typed by hand),
  // "estimate" (saved city-to-city estimate). Null = miles unknown —
  // the $/mi stays blank rather than guessed.
  loadedMiles: real("loaded_miles"),
  milesSource: text("miles_source"),
  // Money & Flow batch (migration 0102): deadhead (empty) miles the
  // driver records for this load — the pickup run that loaded-miles
  // math never saw. The TRUE rate divides total pay by loaded +
  // deadhead. Null = not recorded; the true rate then divides by
  // loaded miles alone and says the deadhead wasn't recorded.
  deadheadMiles: real("deadhead_miles"),
  // Additional charges on this load (migration 0042): flat extra pay
  // added ON TOP of the rate (detention, layover, extra stop, tarp,
  // lumper the carrier reimburses…). The note says what it's for. The
  // load's total = rate + extraCharges whenever a rate is on file.
  extraCharges: real("extra_charges").notNull().default(0),
  extraChargesNote: text("extra_charges_note"),
  weightLbs: integer("weight_lbs"),
  commodity: text("commodity"),
  hazmat: integer("hazmat", { mode: "boolean" }).notNull().default(false),
  // Payment-progress state: "booked" -> "picked_up" -> (POD seal) sealed.
  status: text("status").notNull().default("booked"),
  // The load's reference number (BOL / PO / order #), when the booking
  // named one (migration 0109): typed on a manual load or carried from
  // the board post at claim / assignment-accept.
  referenceNumber: text("reference_number"),
  // Multiple trips (migration 0027): the trip_queue row this load
  // belongs to, when the driver assigns it to one trip. Null = not
  // assigned to a queued trip.
  tripQueueId: integer("trip_queue_id"),
  // After-load fuel debrief (migration 0029): computed at delivery
  // seal from the driver's own fuel log + GPS coach aggregates and
  // saved with the seal. Null until the load is delivered-sealed.
  fuelDebrief: text("fuel_debrief"),
  // SHA-256 fingerprint of the attached document, sealed in the chain.
  docSha256: text("doc_sha256"),
  docBlobKey: text("doc_blob_key"),
  docMime: text("doc_mime"),
  // Pickup documentation — CAMERA-FRESH ONLY (migration 0023). Two slots
  // captured in the app at pickup (PU) after the load is received: the
  // load itself and the BOL. Each slot stores its own blob + SHA-256
  // fingerprint + capture time + GPS + source flag. The server only ever
  // writes source = "camera" here — any non-camera submission is rejected
  // before storage. Gallery/file upload stays allowed for CREATING a
  // load (doc_* above); it is never accepted for these two slots.
  pickupLoadBlobKey: text("pickup_load_blob_key"),
  pickupLoadMime: text("pickup_load_mime"),
  pickupLoadSha256: text("pickup_load_sha256"),
  pickupLoadCapturedAt: integer("pickup_load_captured_at", { mode: "timestamp_ms" }),
  pickupLoadLat: real("pickup_load_lat"),
  pickupLoadLon: real("pickup_load_lon"),
  pickupLoadSource: text("pickup_load_source"), // always "camera" when set
  pickupBolBlobKey: text("pickup_bol_blob_key"),
  pickupBolMime: text("pickup_bol_mime"),
  pickupBolSha256: text("pickup_bol_sha256"),
  pickupBolCapturedAt: integer("pickup_bol_captured_at", { mode: "timestamp_ms" }),
  pickupBolLat: real("pickup_bol_lat"),
  pickupBolLon: real("pickup_bol_lon"),
  pickupBolSource: text("pickup_bol_source"), // always "camera" when set
  // Set when BOTH pickup photos are sealed — the pickup-sealed moment.
  pickupSealedAt: integer("pickup_sealed_at", { mode: "timestamp_ms" }),
  // Equipment type (migration 0026): flatbed | open_deck | rgn |
  // oversized (open family — pickup proof is load + securement) or
  // dry_van | reefer | container (enclosed family — pickup proof is
  // the seal locked on the door + seal-number confirm). Null = not
  // set yet; the driver picks it at the pickup step and it is recorded.
  equipmentType: text("equipment_type"),
  // Trailer number that hauled / is hauling this load.
  trailerNumber: text("trailer_number"),
  // Seal-number confirm (enclosed family): the number the driver read
  // off the physical seal, the number BOL extraction found (if any),
  // and the comparison state: match | mismatch | entered_only |
  // bol_only. A mismatch is stored and shown plainly — never a pass.
  sealEntered: text("seal_entered"),
  sealBol: text("seal_bol"),
  sealStatus: text("seal_status"),
  // Broker identity (migration 0049): the broker this load came from,
  // captured durably when the load is created — from the broker link
  // that carried it (broker upload → board → claim, or solo approval),
  // from a board post that named one, or typed on a manual load. Phase 2
  // broker risk scores build on this history; it cannot be backfilled,
  // so it is written at creation, never reconstructed later. All null on
  // loads that predate the capture (staging rows stay untouched).
  brokerName: text("broker_name"),
  brokerCompany: text("broker_company"),
  brokerMc: text("broker_mc"),
  // broker_link | board_post | manual | null (unknown / predates capture)
  brokerSource: text("broker_source"),
  brokerLinkId: integer("broker_link_id"),
  // Trailer Package (migration 0101) — per-load trailer records:
  // Loaded height in total inches, recorded by the driver at load
  // time (open decks especially — every load rides at its own
  // height). While set, THIS height — not the truck profile's empty
  // height — drives the low-bridge alerts for the trip. Null = not
  // recorded; alerts fall back to the truck profile height.
  loadedHeightIn: integer("loaded_height_in"),
  // Reefer cold chain: the setpoint the load must ride at and the
  // driver's own ± band around it (degrees F). Check-ins live in
  // reefer_checks; every temp there is DRIVER-ENTERED, never a
  // sensor reading.
  reeferSetpointF: real("reefer_setpoint_f"),
  reeferBandF: real("reefer_band_f"),
  // Dock helper: the delivery appointment, the dock door assigned
  // (when known), and the lumper fee paid at the dock with its
  // receipt filed as a blob (fingerprinted like load documents).
  dockApptAt: integer("dock_appt_at", { mode: "timestamp_ms" }),
  dockDoor: text("dock_door"),
  lumperFee: real("lumper_fee"),
  // Final Extras (migration 0103): the driver's own check-in note for
  // this facility visit (gate routine, where to check in, who to ask
  // for) — written in the dock helper, read back by Facility Memory
  // on the NEXT load that names this facility. The driver's words
  // only; never crowdsourced, never another driver's note.
  dockNote: text("dock_note"),
  lumperReceiptBlobKey: text("lumper_receipt_blob_key"),
  lumperReceiptMime: text("lumper_receipt_mime"),
  lumperReceiptSha256: text("lumper_receipt_sha256"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Reefer cold-chain check-ins (migration 0101). One row per
// temperature check the DRIVER types in at a stop — timestamped and
// located like the app's other sealed entries, and sealed into the
// load's chain record at write time (chain_hash). Driver-entered
// only: the app has no reefer sensor feed, and these rows are never
// presented as sensor readings.
export const reeferChecks = sqliteTable("reefer_checks", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  tempF: real("temp_f").notNull(),
  lat: real("lat"),
  lon: real("lon"),
  note: text("note"),
  chainHash: text("chain_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Pre-trip inspection checklists (migration 0101). One row per
// completed checklist: the trailer type it ran for, the per-item
// results as JSON ([{id, label, ok, note}]), an optional photo filed
// as a blob with its fingerprint, and the chain hash that seals the
// inspection into the record. loadId is set when the driver files
// the checklist against a load; null = a standalone pre-trip.
export const pretripInspections = sqliteTable("pretrip_inspections", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id"),
  trailerType: text("trailer_type").notNull(),
  itemsJson: text("items_json").notNull(),
  defectCount: integer("defect_count").notNull().default(0),
  photoBlobKey: text("photo_blob_key"),
  photoMime: text("photo_mime"),
  photoSha256: text("photo_sha256"),
  lat: real("lat"),
  lon: real("lon"),
  chainHash: text("chain_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Fleet Load Board (migration 0047). A board load belongs to exactly
// ONE company and is visible only to that company's members — there is
// no public board and nothing crosses companies. Owner/Dispatch post
// (status "open"); a company driver claims it (status "taken",
// claimMethod "claim"), which creates the driver's real load (loads
// row, Booked) + trip (trip_queue row) and links them here (loadId /
// tripQueueId). Owner/Dispatch can instead ASSIGN it to one named
// driver (migration 0109): the row sits at status "assigned" as a
// pending offer — no load exists yet — until the driver accepts
// (status "taken", claimMethod "assign", load + trip created then) or
// declines with a reason (row returns to "open", reason on the row).
// Owner/Dispatch can unassign a taken load BEFORE pickup: the created
// load/trip are removed and the row returns to "open". The board row
// itself holds a full copy of the load fields so a repost never
// depends on the driver's (deleted) load row. The rate-con / BOL the
// poster uploaded lives in the doc blob columns, sealed by SHA-256
// like a load doc.
export const boardLoads = sqliteTable("board_loads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  postedBy: text("posted_by").notNull(),
  shipper: text("shipper"),
  pickupCity: text("pickup_city"),
  pickupState: text("pickup_state"),
  deliveryCity: text("delivery_city"),
  deliveryState: text("delivery_state"),
  pickupText: text("pickup_text"),
  deliveryText: text("delivery_text"),
  rate: real("rate"),
  // Loaded miles + source (migration 0080) — same rule as loads:
  // $/mi is derived at read time, never stored. Carried onto the
  // driver's load at claim (createLoadFromBoard).
  loadedMiles: real("loaded_miles"),
  milesSource: text("miles_source"),
  extraCharges: real("extra_charges").notNull().default(0),
  extraChargesNote: text("extra_charges_note"),
  weightLbs: integer("weight_lbs"),
  commodity: text("commodity"),
  hazmat: integer("hazmat", { mode: "boolean" }).notNull().default(false),
  equipmentType: text("equipment_type"),
  notes: text("notes"),
  // open | taken | overflowed (a FLEET row whose load was pushed to
  // the Open Board — it leaves the fleet board until recalled; the
  // open copy carries the claim, so the load can never be taken twice)
  status: text("status").notNull().default("open"),
  // claim | assign — how the taken load was taken (null while open).
  claimMethod: text("claim_method"),
  claimedBy: text("claimed_by"),
  claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
  // The driver's load + trip created by the claim/assign (null while open).
  loadId: integer("load_id"),
  tripQueueId: integer("trip_queue_id"),
  docSha256: text("doc_sha256"),
  docBlobKey: text("doc_blob_key"),
  docMime: text("doc_mime"),
  // Broker identity (migration 0049): who this load came from, captured
  // durably at post time so it survives onto the driver's load at claim.
  // Null on posts that name no broker (an owner's own manual post).
  brokerName: text("broker_name"),
  brokerCompany: text("broker_company"),
  brokerMc: text("broker_mc"),
  // broker_link (came through an approved broker upload) | board_post
  brokerSource: text("broker_source"),
  brokerLinkId: integer("broker_link_id"),
  // Open Board (migration 0073): which board this row lives on.
  // "fleet" = the company-private board (every pre-0073 row); "open" =
  // the Open Board, visible/claimable ONLY by vetted owner operators.
  boardScope: text("board_scope").notNull().default("fleet"), // fleet | open
  // Where an OPEN row came from: fleet_overflow (a fleet owner pushed
  // it out) | broker_poster (a desk-released Broker Portal load).
  // Null on plain fleet rows.
  originKind: text("origin_kind"),
  // The origin's display name, kept on the board and in the claim
  // flow: the fleet's company name or the broker's name.
  originLabel: text("origin_label"),
  // The fleet company an overflow load came from (null for broker
  // loads — their companyId is the reviewing desk's company).
  originCompanyId: integer("origin_company_id"),
  // Dispatcher fee % snapshot (migration 0088): the POSTER's own
  // dispatcher fee at the moment this row was posted (a dispatch
  // company's own board post) or released (a Broker Portal load —
  // the poster account's override, else its dispatch company's
  // setting). Shown on the card BEFORE claiming, beside the poster
  // name: the claiming carrier pays it once per load. Null = the
  // poster set no fee (0%). A snapshot, never re-read live, so a
  // later fee change never rewrites a live load's terms.
  dispatcherFeePct: real("dispatcher_fee_pct"),
  // Open rows are vetted-only by construction; the flag rides on the
  // row so the board shape can say so plainly.
  vettedOnly: integer("vetted_only", { mode: "boolean" }).notNull().default(false),
  // Why the fleet owner pushed this load out: fleet_full |
  // short_on_drivers (null unless originKind = fleet_overflow).
  overflowReason: text("overflow_reason"),
  // The fleet board row this open row was copied from (overflow), and
  // the Broker Portal load a broker open row was released from.
  overflowFromBoardLoadId: integer("overflow_from_board_load_id"),
  brokerPosterLoadId: integer("broker_poster_load_id"),
  // Assign-to-driver flow (migration 0109): status gains "assigned" —
  // an offer naming claimedBy (the driver) that NO driver load backs
  // yet; the load + trip are created only when the driver ACCEPTS
  // (status flips to "taken"). A DECLINE returns the row to "open"
  // and leaves its words on the row for the desk: the reason, who
  // declined, and when — cleared the next time the row is taken or
  // offered. The booked load's reference number (BOL / PO / order #)
  // and its pickup / delivery appointment instants ride the row and
  // carry onto the driver's load at accept (reference + the delivery
  // appointment, which becomes the load's dock appointment).
  referenceNumber: text("reference_number"),
  pickupApptAt: integer("pickup_appt_at", { mode: "timestamp_ms" }),
  deliveryApptAt: integer("delivery_appt_at", { mode: "timestamp_ms" }),
  declineReason: text("decline_reason"),
  declinedBy: text("declined_by"),
  declinedAt: integer("declined_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Broker upload links + approval queue (migration 0048) -----------------
// OPTIONAL feature, OFF by default, for Diamond owner-operators (solo,
// personal version) and Fleet/Owner accounts (company version) only.
// Gold/Basic never get it. The opt-in is one row per scope: a company
// scope ("company:<id>") for fleets — Owner toggles it, Owner/Dispatch
// manage links and the inbox — or a solo scope ("user:<username>") for
// a Diamond owner-operator managing their own links and inbox.
export const brokerOptins = sqliteTable("broker_optins", {
  scopeKey: text("scope_key").primaryKey(), // company:<id> | user:<username>
  companyId: integer("company_id"),
  ownerUsername: text("owner_username").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One link per broker (never one shared link for everyone). The token
// is an unguessable random secret; the link is UPLOAD-ONLY — it grants
// no view of the board, drivers, other loads, prices, HOS, or documents.
// Expired (expiresAt passed) or revoked (revokedAt set) links are dead.
export const brokerLinks = sqliteTable("broker_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scopeKey: text("scope_key").notNull(),
  companyId: integer("company_id"),
  ownerUsername: text("owner_username").notNull(), // account the inbox belongs to
  // broker (one named broker's upload link) | door (migration 0110:
  // the fleet's standing SEND DOOR — one per fleet scope, named by
  // nobody: the sender identifies THEMSELVES in the form, and the
  // offer lands only in this fleet's inbox).
  kind: text("kind").notNull().default("broker"),
  brokerName: text("broker_name").notNull(),
  brokerCompany: text("broker_company"),
  brokerContact: text("broker_contact"),
  // Broker MC number, when the broker provided one (migration 0049).
  // Captured durably so Phase 2 broker risk scores have a stable
  // identity to build history on — name alone is not an identity.
  brokerMc: text("broker_mc"),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A broker submission lands HERE — the Broker Inbox — never directly
// on the Fleet Board and never visible to drivers. Owner/Dispatch (or
// the solo Diamond owner-operator) reviews, edits every field, then
// approves (fleet → a board_loads row, doc attached; solo → the
// owner's own load at Booked + its trip) or rejects. Rejected rows are
// KEPT on record. The doc columns carry the uploaded rate con/BOL,
// fingerprinted (SHA-256) and sealed like every load document. The
// audit trail is the row itself (broker + link, submitted time, doc
// fingerprint, reviewer + review time) plus hash-chain events.
export const brokerSubmissions = sqliteTable("broker_submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  linkId: integer("link_id").notNull(),
  scopeKey: text("scope_key").notNull(),
  companyId: integer("company_id"),
  ownerUsername: text("owner_username").notNull(),
  brokerName: text("broker_name").notNull(), // as submitted (link's broker name by default)
  brokerCompany: text("broker_company"),
  brokerMc: text("broker_mc"), // from the link, when provided (migration 0049)
  // Send-door offers (migration 0110): the sender's own contact, and
  // the booked load's reference number + pickup / delivery
  // appointments as the SENDER stated them — carried onto the board
  // post at approval, exactly like the lane and rate. Named-link
  // submissions may carry them too (same form); null when unstated.
  senderContact: text("sender_contact"),
  referenceNumber: text("reference_number"),
  pickupApptAt: integer("pickup_appt_at", { mode: "timestamp_ms" }),
  deliveryApptAt: integer("delivery_appt_at", { mode: "timestamp_ms" }),
  shipper: text("shipper"),
  pickupCity: text("pickup_city"),
  pickupState: text("pickup_state"),
  deliveryCity: text("delivery_city"),
  deliveryState: text("delivery_state"),
  pickupText: text("pickup_text"),
  deliveryText: text("delivery_text"),
  rate: real("rate"),
  // Loaded miles + source (migration 0080) — carried onto the board
  // post / driver load at approval so the $/mi survives the lane.
  loadedMiles: real("loaded_miles"),
  milesSource: text("miles_source"),
  extraCharges: real("extra_charges").notNull().default(0),
  extraChargesNote: text("extra_charges_note"),
  weightLbs: integer("weight_lbs"),
  commodity: text("commodity"),
  hazmat: integer("hazmat", { mode: "boolean" }).notNull().default(false),
  equipmentType: text("equipment_type"),
  notes: text("notes"),
  // pending | approved | rejected
  status: text("status").notNull().default("pending"),
  docSha256: text("doc_sha256"),
  docBlobKey: text("doc_blob_key"),
  docMime: text("doc_mime"),
  // Set on approval: the fleet board post (fleet mode) or the owner's
  // own load + trip (solo mode).
  boardLoadId: integer("board_load_id"),
  loadId: integer("load_id"),
  tripQueueId: integer("trip_queue_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
  reviewNote: text("review_note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Instant Pay Phase 0 — Payment Packet + invoice registry (0049) -------
// RECORDS ONLY. No money moves in Phase 0: no escrow, no advances, no
// releases. A Payment Packet is the per-load assembly of records the
// app already captures — the rate confirmation as fingerprinted at
// booking, the BOL as fingerprinted at pickup, the sealed POD, and a
// generated invoice matching the rate terms — bound under ONE packet
// identity and ONE packet fingerprint (SHA-256 over the canonical
// assembly). It is assembled at the delivery seal (and on demand for
// loads sealed before packets existed). One packet per load, ever:
// load_id is unique; a re-seal after a void refreshes the POD linkage
// on the same packet rather than minting a second one.
export const paymentPackets = sqliteTable("payment_packets", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull().unique(),
  // Human-facing packet identity, e.g. "PKT-1042-9f3ac21b" — the load
  // id plus the first 8 of the packet fingerprint.
  packetRef: text("packet_ref").notNull(),
  // SHA-256 over the packet's canonical assembly (invoice fingerprint +
  // component fingerprints + broker identity + amount + seal hash).
  fingerprint: text("fingerprint").notNull(),
  // The generated invoice for this load (rate + additional charges, on
  // the rate confirmation's terms) and ITS fingerprint — the value the
  // invoice registry guards. Deterministic per load: the same load
  // always produces the same invoice fingerprint.
  invoiceRef: text("invoice_ref").notNull(),
  invoiceFingerprint: text("invoice_fingerprint").notNull(),
  invoiceAmount: real("invoice_amount"),
  // Broker identity snapshot at assembly (from the load's durable
  // broker capture — migration 0049). Nulls stay null: a packet never
  // invents a broker the load didn't record.
  brokerName: text("broker_name"),
  brokerCompany: text("broker_company"),
  brokerMc: text("broker_mc"),
  brokerSource: text("broker_source"),
  brokerLinkId: integer("broker_link_id"),
  // Component fingerprints, exactly as sealed elsewhere in the app.
  rateConSha256: text("rate_con_sha256"), // loads.doc_sha256 (booking doc)
  bolSha256: text("bol_sha256"), // loads.pickup_bol_sha256 (pickup BOL)
  podSealHash: text("pod_seal_hash"), // chain hash of the live pod_seal
  // Registry outcome at assembly: true when this invoice fingerprint
  // was ALREADY registered by an earlier packet on a DIFFERENT load —
  // the double-financing warning, recorded on the packet itself.
  invoiceSeenBefore: integer("invoice_seen_before", { mode: "boolean" })
    .notNull()
    .default(false),
  // The load-INDEPENDENT receivable key (migration 0051): SHA-256 over
  // the receivable's own facts only — rate-con document fingerprint +
  // broker identity (MC preferred, else normalized company, else
  // normalized name) + invoice amount, canonical version
  // "stonemiles-receivable-v1" (server/src/receivableKey.ts). No load
  // id anywhere in it, so the same receivable under two load records
  // produces the SAME key — the cross-load duplicate signal the
  // load-scoped invoice fingerprint structurally cannot give. Null on
  // packets assembled before migration 0051 (never rewritten).
  receivableKey: text("receivable_key"),
  // True when this packet's receivable key was FIRST registered by an
  // earlier packet on a DIFFERENT load — the same receivable (same
  // rate-con + broker + amount) presented twice.
  receivableSeenBefore: integer("receivable_seen_before", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The invoice fingerprint registry (migration 0049): APPEND-ONLY. One
// row per invoice fingerprint, written at packet creation — the first
// registration wins and is never updated or deleted. A lookup answers
// "has this invoice fingerprint been registered before, and by which
// load/packet first?" — the record-level double-financing guard the
// later phases check before any escrow release or advance exists.
export const invoiceRegistry = sqliteTable("invoice_registry", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fingerprint: text("fingerprint").notNull().unique(),
  packetId: integer("packet_id").notNull(),
  loadId: integer("load_id").notNull(),
  packetRef: text("packet_ref").notNull(),
  registeredAt: integer("registered_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The receivable-key registry (migration 0051): APPEND-ONLY sibling of
// invoice_registry, one row per receivable key (UNIQUE), first
// registration wins and is never updated or deleted. Because the key is
// built only from the receivable's own facts (rate-con fingerprint +
// broker identity + amount — see receivableKey.ts), a second load
// presenting the same receivable looks up the SAME key and finds the
// first registration: the double-financing detection the load-scoped
// invoice fingerprint cannot perform.
export const receivableRegistry = sqliteTable("receivable_registry", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receivableKey: text("receivable_key").notNull().unique(),
  packetId: integer("packet_id").notNull(),
  loadId: integer("load_id").notNull(),
  packetRef: text("packet_ref").notNull(),
  registeredAt: integer("registered_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Dispatch fees — RUGGS LLC load-board lane (migration 0052) ------------
// RECORDS + GATE ONLY: no live card capture, no money movement inside
// the app. When a BOARD-CLAIMED load's POD seals, its Payment Packet
// spawns exactly one fee invoice here: fee = 10% of the packet's final
// freight amount (rate + additional charges). load_id is UNIQUE — one
// fee per load, ever; a packet refresh with a corrected amount updates
// freight/fee on the same row (sealed as an event), never a second
// invoice. Loads with no taken board_loads row (Granted-lane loads
// under the RUGGS LLC→Granted agent agreement, manual loads, solo loads)
// never get a row here — the board-claim provenance IS the guard.
// The collection ladder (window / warning at day 7 / revoked at day
// 10) is COMPUTED from delivered_at + payments at read time (see
// server/src/dispatchFee.ts) — it is never stored, so it can never
// drift from the payment record. paid_at stamps the moment the
// invoice reached paid-in-full, which is what keeps warning/late
// history visible after settlement.
export const dispatchFeeInvoices = sqliteTable("dispatch_fee_invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull().unique(),
  boardLoadId: integer("board_load_id"),
  packetId: integer("packet_id"),
  companyId: integer("company_id").notNull(),
  // The carrier who claimed the board load and owes the fee.
  carrierUsername: text("carrier_username").notNull(),
  freightAmount: real("freight_amount").notNull(),
  feeAmount: real("fee_amount").notNull(),
  paidAmount: real("paid_amount").notNull().default(0),
  // The delivery moment: the POD seal time for this load.
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }).notNull(),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  // Staging probe loads keep their invoices, labelled PROBE.
  probe: integer("probe", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Platform fee entries (migration 0089, x 2026-11-02 correction):
// a DISPATCH-ONLY company (kind "dispatch", Fleet Owner plan NOT
// activated) pays the platform 2% of a load's gross pay when a load
// it posted/dispatched reaches SEALED DELIVERY — and (round 3,
// migration 0090) a SOLO DISPATCHER POSTER (a profile that opened
// My Desk; social_users.dispatcher_poster) accrues the same 2% on
// their own public-board loads, owed as a person (company_id NULL).
// Recorded here at
// the seal, one row per load ever (UNIQUE load_id, the same
// idempotency shape as dispatch_fee_invoices), labelled on the
// record and in the Dispatch Desk as "Platform fee 2% — invoiced at
// sealed delivery". RECORDS ONLY: no money moves in the app for
// this fee (settlement happens outside the app, like the
// dispatcher's own fee). Converted companies (Fleet Owner active)
// never accrue it, and loads on a converted company's private board
// carry no fee mechanics at all. Pure rules: platformFee.ts.
export const platformFeeEntries = sqliteTable("platform_fee_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull().unique(),
  boardLoadId: integer("board_load_id"),
  // The dispatch-only company that owes the platform fee — the
  // accounting entity for company posters. NULL for a SOLO
  // dispatcher poster (migration 0090, round 3): they owe it as a
  // person, under posterUsername, with no company over them.
  companyId: integer("company_id"),
  // The person who posted the load (broker_poster_loads.created_by,
  // captured at accrual; backfilled for pre-0090 rows from the same
  // chain). My Desk's platform-fee view is scoped by THIS column —
  // a person only ever sees accruals on loads they posted.
  posterUsername: text("poster_username"),
  // The carrier who claimed the load and ran it to sealed delivery.
  carrierUsername: text("carrier_username").notNull(),
  // The load's gross pay (final freight: rate + extras — the same
  // basis freightAmountFor computes for the RUGGS house fee).
  grossAmount: real("gross_amount").notNull(),
  feeAmount: real("fee_amount").notNull(),
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One row per recorded dispatch-fee payment (admin/RUGGS LLC-recorded —
// the carrier pays off-app by ACH, debit, or crypto and the desk
// records it here with its reference). Partial payments record here
// and raise the invoice's paid_amount; only paid-in-full clears the
// settle-to-claim gate. verification: "admin_confirmed" (the desk
// recorded it; on-chain verification could not run — e.g. no fee
// address configured) | "onchain_verified" (the crypto tx hash was
// found on-chain) | "onchain_not_found" (verification ran and the tx
// was not found — the record says so plainly).
export const dispatchFeePayments = sqliteTable("dispatch_fee_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull(),
  loadId: integer("load_id").notNull(),
  rail: text("rail").notNull(), // ach | debit | crypto
  reference: text("reference").notNull(), // ACH trace / card receipt ref / crypto tx hash
  amount: real("amount").notNull(),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  verification: text("verification").notNull().default("admin_confirmed"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Rate-con / BOL cross-verification (migration 0053). The check that
// puts the two documents a load runs on side by side: the rate
// confirmation's extracted field set against the BOL's, field by
// field (pure engine: server/src/docVerify.ts).
//
// EXTRACTION SNAPSHOTS: one row per document read — the field set the
// app's extraction produced for ONE side of ONE load, tied to the
// fingerprint of the exact document it was read from. A new read of
// the same side (re-attached rate con, re-shot BOL) adds a row; the
// latest row for a side + document fingerprint is the side the
// verification runs on. source: "document" (the extraction read the
// document itself) | "confirmed" (the field set the driver confirmed
// for that document — a PDF rate con the vision reader can't open) |
// "load_record" (synthesized at run time from the load record for
// loads that predate snapshots). found = the read actually saw load
// details on the document; a read that found none stores found=false
// with all-null fields and the run reports that side not-readable.
export const loadDocExtractions = sqliteTable("load_doc_extractions", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  side: text("side").notNull(), // ratecon | bol
  source: text("source").notNull(), // document | confirmed | load_record
  docSha256: text("doc_sha256"),
  found: integer("found", { mode: "boolean" }).notNull().default(false),
  fieldsJson: text("fields_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// VERIFICATION RUNS: append-only, one row per run. report_json holds
// the full field-by-field report (both values + outcome per field);
// outcomes_hash is the SHA-256 of the report's canonical outcomes
// string — the same hash sealed into the chain event, so the stored
// report provably matches what was sealed. Runs are never edited or
// deleted (load deletion aside): a re-run is a new row, and the
// mismatch history stands even after an exception is acknowledged.
export const loadDocVerifications = sqliteTable("load_doc_verifications", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  runBy: text("run_by").notNull(),
  verdict: text("verdict").notNull(), // verified | differences_found | incomplete
  reportJson: text("report_json").notNull(),
  outcomesHash: text("outcomes_hash").notNull(),
  rateconSha256: text("ratecon_sha256"),
  bolSha256: text("bol_sha256"),
  chainHash: text("chain_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// CROSS-VERIFICATION EXCEPTIONS: one row per (load, field) mismatch
// episode. Opened by a run whose report mismatches the field; closed
// ONLY by (a) a later run showing the field matching (close_kind
// "rerun_match") or (b) an explicit acknowledgment by the driver or
// an owner/dispatch seat (close_kind "acknowledged", with who +
// reason, sealed). The seal-grade evaluation reads the OPEN rows —
// a load with any open row cannot reach release-grade. Closing never
// edits the verification report that opened it.
export const loadDocExceptions = sqliteTable("load_doc_exceptions", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  field: text("field").notNull(),
  fieldLabel: text("field_label").notNull(),
  rateconValue: text("ratecon_value"),
  bolValue: text("bol_value"),
  status: text("status").notNull().default("open"), // open | closed
  openedByRun: integer("opened_by_run"),
  openedAt: integer("opened_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  closedBy: text("closed_by"),
  closeKind: text("close_kind"), // rerun_match | acknowledged
  closeReason: text("close_reason"),
});

// Extra securement photos for open-deck pickups (migration 0026):
// the main pickup load slot holds the first load + securement photo;
// additional securement angles land here. Camera-fresh only, same law.
export const pickupExtraPhotos = sqliteTable("pickup_extra_photos", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  blobKey: text("blob_key").notNull(),
  mime: text("mime").notNull(),
  sha256: text("sha256").notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
  lat: real("lat"),
  lon: real("lon"),
  source: text("source").notNull(), // always "camera" when stored
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Drop & hook trailer swaps (migration 0026). One row per swap: the
// dropping driver's fresh camera photo of the dropped trailer (REQUIRED
// — a swap row cannot exist without it), the BOL handoff record, and,
// when the receiver is a STONEMILES user, the receiving driver's fresh
// camera hook photo taken as they receive the trailer. The two photos
// pair in the custody chain: condition at drop vs condition at hook.
// A receiver who is not in the app is recorded by name/company AS
// ENTERED by the dropping driver (receiverKind "external", status
// "recorded_external") and NEVER gets a fabricated hook photo.
// Drop/hook location is city + state only, GPS-derived and labelled.
export const trailerSwaps = sqliteTable("trailer_swaps", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  trailerNumber: text("trailer_number").notNull(),
  dropperUsername: text("dropper_username").notNull(),
  // app (receiver is a STONEMILES user who confirms in-app) | external
  receiverKind: text("receiver_kind").notNull(),
  receiverUsername: text("receiver_username"),
  receiverName: text("receiver_name"), // as entered by the dropping driver
  receiverCompany: text("receiver_company"),
  // pending_receiver (app receiver hasn't confirmed) | completed |
  // recorded_external
  status: text("status").notNull(),
  dropBlobKey: text("drop_blob_key").notNull(),
  dropMime: text("drop_mime").notNull(),
  dropSha256: text("drop_sha256").notNull(),
  dropCapturedAt: integer("drop_captured_at", { mode: "timestamp_ms" }).notNull(),
  dropLat: real("drop_lat"),
  dropLon: real("drop_lon"),
  dropCity: text("drop_city"),
  dropState: text("drop_state"),
  dropLocationSource: text("drop_location_source").notNull(), // gps_derived | gps_no_fix
  hookBlobKey: text("hook_blob_key"),
  hookMime: text("hook_mime"),
  hookSha256: text("hook_sha256"),
  hookCapturedAt: integer("hook_captured_at", { mode: "timestamp_ms" }),
  hookLat: real("hook_lat"),
  hookLon: real("hook_lon"),
  hookCity: text("hook_city"),
  hookState: text("hook_state"),
  hookLocationSource: text("hook_location_source"),
  hookUsername: text("hook_username"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

// ---- Next Level (migration 0016): IFTA fuel, money truth, verify, DVIR ----

// Every fuel purchase, sealed in the chain. State comes from the driver's
// GPS position at purchase time (or a manual pick) — full state name.
export const fuelPurchases = sqliteTable("fuel_purchases", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  purchasedAt: integer("purchased_at", { mode: "timestamp_ms" }).notNull(),
  state: text("state").notNull(),
  station: text("station"),
  gallons: real("gallons").notNull(),
  pricePerGallon: real("price_per_gallon").notNull(),
  total: real("total").notNull(),
  odometer: real("odometer"),
  receiptBlobKey: text("receipt_blob_key"),
  receiptMime: text("receipt_mime"),
  receiptSha256: text("receipt_sha256"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Fuel prices at named stops (Net-Price Fuel Planner v1) — the shared,
// ANONYMOUS price layer: no username is ever stored on a row. Sources,
// by GRADE (migration 0059):
// - "reported": a driver's own manual sighting (reportFuelPrice) —
//   always carries real coordinates from the report form.
// - "purchase": filed automatically from a logged fuel purchase
//   (logFuelPurchase) with no receipt attached.
// - "receipt_verified": filed automatically from a logged fuel
//   purchase whose receipt photo was fingerprinted (SHA-256) — the
//   strongest grade of price evidence.
// The purchase form collects NO coordinates, so purchase-derived rows
// carry NULL lat/lon — coordinates are never fabricated for them;
// they match stops by station name + state instead. Always displayed
// with age + source/grade, never presented as a live station price.
// Sealed in the hash chain at file time.
export const fuelPriceReports = sqliteTable("fuel_price_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  station: text("station").notNull(),
  lat: real("lat"),
  lon: real("lon"),
  state: text("state"),
  price: real("price").notNull(),
  reportedAt: integer("reported_at", { mode: "timestamp_ms" }).notNull(),
  // receipt_verified | purchase | reported (see the grade comment above)
  grade: text("grade").notNull().default("reported"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// EIA weekly on-highway diesel averages (migration 0079) — REGIONAL
// CONTEXT ONLY, never a station price. One row per EIA week (week_of
// is the week's Monday, ISO YYYY-MM-DD, UNIQUE so a refresh can never
// duplicate a week). Rows are written ONLY by the weekly refresh in
// server/src/eiaDiesel.ts (scheduled weekly + a throttled on-read
// fallback): a failed or self-disagreeing refresh writes nothing and
// readers keep serving the newest row — the last good week — with its
// age labelled. source names where the values came from (the live
// EIA pages, or the labelled Oct 22, 2026 research-snapshot seed that
// bootstraps the table); fetched_at is when that row's values were
// obtained. No per-station price is ever stored here.
export const eiaDieselSnapshots = sqliteTable("eia_diesel_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekOf: text("week_of").notNull().unique(),
  national: real("national").notNull(),
  gulfCoast: real("gulf_coast").notNull(),
  westCoast: real("west_coast").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// MARKET PULSE weekly spot-rate context (migration 0096, x-approved
// 2026-11-04 as a freeze exception — the EIA-diesel precedent applied
// to spot rates). One row per published week (week_ending is the
// week's Friday, ISO YYYY-MM-DD, UNIQUE so a manual entry can never
// duplicate a week). MARKET DIRECTION ONLY: broker-posted averages
// from the source's public weekly summary — never a quote for any
// specific load. Per-equipment ABSOLUTE $/mi rates (migration 0098)
// ARE stored when the week's full report publishes them — the
// summary post x first reviewed carried direction only, but the
// full Week 43 report publishes flatbed $3.31 / dry van $2.85 /
// reefer $3.45; a week whose report doesn't publish a lane's rate
// stores NULL and the card shows direction only for that lane.
// Lanes no weekly index publishes (step-deck, tanker, power only,
// hotshot, oversize/heavy haul) get NO columns and NO numbers —
// they ride the view as an honest no-index coverage list. Rows
// are written ONLY by the manual-entry action (saveMarketPulseWeek)
// from public summaries — there is NO scraping of Truckstop/FTR —
// and the table bootstraps from MARKET_PULSE_SEED (the verified
// Week 43 figures x handed over) so the first read always has the
// last good week. Readers serve the newest row with its week
// labelled plainly; a row older than ~2 weeks is flagged stale.
export const marketPulseWeeks = sqliteTable("market_pulse_weeks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekNumber: integer("week_number").notNull(),
  weekEnding: text("week_ending").notNull().unique(), // ISO YYYY-MM-DD
  totalRatePerMile: real("total_rate_per_mile").notNull(),
  totalChangeCents: real("total_change_cents").notNull(),
  totalYoyPct: real("total_yoy_pct").notNull(),
  totalLoadsChangePct: real("total_loads_change_pct").notNull(),
  mdiNote: text("mdi_note"),
  flatbedChangeCents: real("flatbed_change_cents").notNull(),
  flatbedYoyPct: real("flatbed_yoy_pct").notNull(),
  flatbedLoadsChangePct: real("flatbed_loads_change_pct").notNull(),
  dryvanChangeCents: real("dryvan_change_cents").notNull(),
  dryvanYoyPct: real("dryvan_yoy_pct").notNull(),
  dryvanLoadsChangePct: real("dryvan_loads_change_pct").notNull(),
  reeferChangeCents: real("reefer_change_cents").notNull(),
  reeferYoyPct: real("reefer_yoy_pct").notNull(),
  reeferLoadsChangePct: real("reefer_loads_change_pct").notNull(),
  // Per-equipment absolute spot rates, $/mi incl. fuel (migration
  // 0098). Nullable: only stored when the week's published report
  // carries the lane's absolute — never derived from the changes.
  flatbedRatePerMile: real("flatbed_rate_per_mile"),
  dryvanRatePerMile: real("dryvan_rate_per_mile"),
  reeferRatePerMile: real("reefer_rate_per_mile"),
  source: text("source").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Business expenses from the driver's OWN records only — the raw material
// for real cost-per-mile and break-even. Categories double as tax buckets.
export const expenses = sqliteTable("expenses", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  spentAt: integer("spent_at", { mode: "timestamp_ms" }).notNull(),
  category: text("category").notNull(), // fuel | tolls | lumper | maintenance | insurance | scale | parking | permits | meals | supplies | other (driver-confirmed; meals + supplies added by the Final Extras batch)
  amount: real("amount").notNull(),
  vendor: text("vendor"),
  state: text("state"),
  loadId: integer("load_id"),
  notes: text("notes"),
  receiptBlobKey: text("receipt_blob_key"),
  receiptMime: text("receipt_mime"),
  receiptSha256: text("receipt_sha256"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Imported carrier settlements + the sealed line-by-line check against the
// driver's own sealed trips/loads/detention. Lines and check are JSON.
export const settlements = sqliteTable("settlements", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  carrier: text("carrier"),
  periodLabel: text("period_label"),
  gross: real("gross"),
  net: real("net"),
  linesJson: text("lines_json").notNull().default("[]"),
  docBlobKey: text("doc_blob_key"),
  docMime: text("doc_mime"),
  docSha256: text("doc_sha256"),
  checkJson: text("check_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// CAT-scale style weigh tickets: per-axle weights, sealed with the photo.
export const scaleTickets = sqliteTable("scale_tickets", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  weighedAt: integer("weighed_at", { mode: "timestamp_ms" }).notNull(),
  location: text("location"),
  state: text("state"),
  steerLbs: integer("steer_lbs"),
  driveLbs: integer("drive_lbs"),
  trailerLbs: integer("trailer_lbs"),
  grossLbs: integer("gross_lbs"),
  loadId: integer("load_id"),
  photoBlobKey: text("photo_blob_key"),
  photoMime: text("photo_mime"),
  photoSha256: text("photo_sha256"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Driver's personal document vault: CDL, medical card, insurance,
// registration, IFTA licence. Only kind/label/expiry/last-4 live as fields —
// the document itself is a blob; reminders come from the expiry dates the
// driver entered.
export const personalDocs = sqliteTable("personal_docs", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // cdl | medical | insurance | registration | ifta_licence | other
  label: text("label").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  docNumberLast4: text("doc_number_last4"),
  notes: text("notes"),
  blobKey: text("blob_key"),
  mime: text("mime"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Verify-Anywhere codes: a short code anyone can enter (no account) to
// confirm a sealed record is genuine. The code maps to the record's chain
// hash + a state-level summary — never a precise location, never wallet
// data. Custody codes are minted per load for the receiver's check.
export const verifyCodes = sqliteTable("verify_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  kind: text("kind").notNull(), // trip | load | pod | ifta | settlement | passport
  refId: integer("ref_id"),
  recordHash: text("record_hash").notNull(),
  summary: text("summary").notNull(), // JSON, state-level only
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Formal DVIR: the pretrip upgraded to a signed inspection report with a
// defect workflow (defects surface to the owner portal feed).
export const dvirReports = sqliteTable("dvir_reports", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  inspectedAt: integer("inspected_at", { mode: "timestamp_ms" }).notNull(),
  kind: text("kind").notNull().default("pretrip"), // pretrip | posttrip
  itemsJson: text("items_json").notNull().default("[]"),
  defectsJson: text("defects_json").notNull().default("[]"),
  signedName: text("signed_name").notNull(),
  status: text("status").notNull().default("signed"), // signed | defects_reported | cleared
  odometer: real("odometer"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- ELD cloud connections (migration 0019) --------------------------------
// Read-only connections to cloud ELD platforms (Samsara first, then
// Motive; Geotab is "coming next" — no row type exists for it yet). The
// fleet admin creates an API token in their OWN provider dashboard and
// pastes it here — never a platform password. The token is stored
// AES-GCM encrypted in the PII vault (same pattern as the EIN); reads
// return only a mask (last 4), and the full token leaves the server only
// through the PIN-gated, audited reveal action. STONEMILES only ever
// READS from a provider — no write endpoint exists anywhere in the app.
// Production starts with NO rows: disconnected and empty, no fabricated
// ELD data. Live provider API sync activates with the native wrap /
// backend (staged, like billing); eld_snapshots is where synced feeds
// land when it does.
export const eldConnections = sqliteTable("eld_connections", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(), // samsara | motive
  companyId: integer("company_id"),
  label: text("label").notNull(), // admin-chosen name, e.g. "Fleet Samsara"
  // not_connected | validating | connected | error | revoked
  status: text("status").notNull().default("not_connected"),
  tokenEnc: text("token_enc"), // enc:v1:… vault ciphertext; null after revoke
  tokenLast4: text("token_last4"),
  // JSON: [{ feed, state, detail }] — the post-connect data-availability
  // check: which feeds actually arrived vs which the provider plan
  // blocks vs which are still awaiting the first (staged) sync. Never
  // silently empty: every mapped feed always has an explicit state.
  feedsJson: text("feeds_json").notNull().default("[]"),
  lastError: text("last_error"),
  connectedBy: text("connected_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

// Synced ELD feed payloads, exactly as received from the provider (the
// sync mapping in actions.ts names the endpoint each feed comes from).
// Empty until live sync activates at go-live — the app never invents
// rows here. Feeds: hos_clocks | hos_logs | dvirs | vehicle_stats | ifta.
export const eldSnapshots = sqliteTable("eld_snapshots", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionId: integer("connection_id").notNull(),
  feed: text("feed").notNull(),
  payloadJson: text("payload_json").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ELD identity log (x, 2026-11-01, spec §6): on ELD connect, the driver
// + truck identity the provider reports is pulled and stored here —
// driver_json: { name, driverId, cdlNumber, cdlState, cdlClass,
// cdlEndorsements, homeTerminal } and truck_json: { unitNumber, vin,
// make, model, year, plate, odometerMi }, every field nullable (the
// log holds only what the ELD actually carried — nothing is filled
// in). One row per pull; the latest row is what the surfaces show,
// stamped "from ELD — <provider>, <pulled_at>".
// NO-TRANSMISSION BOUNDARY: this is the driver's own data in their
// own app. No export, share, sync-out, or telemetry path reads this
// table; the only reader is getEldIdentity, which returns it to the
// driver's own client. Pulled values join trip records only where
// trips already seal driver/truck identity — nowhere new. Empty
// until a real provider sync lands (sync is staged); no row is ever
// fabricated.
export const eldIdentity = sqliteTable("eld_identity", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionId: integer("connection_id").notNull(),
  provider: text("provider").notNull(), // adapter key: motive | samsara | …
  driverJson: text("driver_json").notNull().default("{}"),
  truckJson: text("truck_json").notNull().default("{}"),
  pulledAt: integer("pulled_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Server-only vault key store (single row, id = 1). Holds the 256-bit
// AES-GCM key for the PII vault (EIN, ELD API tokens) as hex. NO action
// ever returns this row, no export includes it, and the full data wipe
// deletes it with everything else. It lives in its own table — not in
// any user-data table — and was moved out of blob storage because blob
// URLs are document-relative and cannot be fetched back from inside a
// server action (see vaultKey in actions.ts).
export const vaultKeys = sqliteTable("vault_keys", {
  id: integer("id").primaryKey(),
  keyHex: text("key_hex").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Safety Training Academy (migration 0021) ------------------------------
// Premium (Diamond Driver / Owner). Every quiz attempt is recorded — pass or
// fail. A completion exists ONLY where a quiz was passed; each completion
// is also sealed into the hash chain (chain_hash stores that entry's
// hash). Core courses (Defensive Driving, HOS, Pre-Trip/DVIR) come due
// again as refreshers every 31-day season, so completions are keyed by
// season_number; history is archived, never deleted. Production starts
// EMPTY — no completions or attempts exist until a driver earns them.
export const trainingAttempts = sqliteTable("training_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  courseId: text("course_id").notNull(),
  seasonNumber: integer("season_number").notNull(),
  scorePct: integer("score_pct").notNull(),
  correctCount: integer("correct_count").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const trainingCompletions = sqliteTable("training_completions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  courseId: text("course_id").notNull(),
  seasonNumber: integer("season_number").notNull(),
  scorePct: integer("score_pct").notNull(),
  // The hash-chain entry that sealed this completion (event
  // "training_completed"). Null only if the seal write ever failed —
  // the completion write and the seal happen in the same handler.
  chainHash: text("chain_hash"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Owner-uploaded training videos (migration 0022). COMPANY-ONLY: a video
// belongs to exactly one company and is visible solely to that company's
// members; it is stored as a blob under the company document-vault rules.
// courseId set = the video is a lesson inside that Academy course; null =
// a standalone company lesson. quizCourseId optionally attaches one of the
// Academy quizzes; customCheckJson optionally carries one owner-written
// check question ({question, options, correctIndex} — the key never
// leaves the server). Production starts EMPTY — no pre-uploaded videos.
export const trainingMedia = sqliteTable("training_media", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  mime: text("mime").notNull(),
  blobKey: text("blob_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  courseId: text("course_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  quizCourseId: text("quiz_course_id"),
  customCheckJson: text("custom_check_json"),
  removedAt: integer("removed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Honest watch progress per driver per video: started on first play,
// progress_pct is the furthest point reached, and the row completes at
// the end threshold (>= 90% watched) plus a passed attached check when
// the owner attached one. Completion seals into the hash chain exactly
// like an Academy course completion, labelled source "owner-uploaded".
export const trainingWatch = sqliteTable("training_watch", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  mediaId: integer("media_id").notNull(),
  progressPct: integer("progress_pct").notNull().default(0),
  status: text("status").notNull().default("started"), // started | completed
  checkPassed: integer("check_passed", { mode: "boolean" }).notNull().default(false),
  chainHash: text("chain_hash"),
  startedAt: integer("started_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastWatchedAt: integer("last_watched_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

// ---- Full onboarding suite (migration 0024) -------------------------------
// Resumable guided onboarding (PREMIUM support: Diamond Driver / Owner;
// the free plain path — signup, join with a code, basic profile — never
// needs this table). One row per username, created lazily on the first
// onboarding write; NO row = brand-new to onboarding. stepsJson maps
// track -> stepId -> { status: "done" | "skipped", at }. A skipped step
// stays listed as not-done — it is never a completion. Verified steps
// (profile saved, ELD connected, first course passed, company setup
// complete, codes issued) are ALSO derived from the real records at
// read time, so a checklist can never claim what the app can't see.
// Production starts EMPTY.
export const onboardingState = sqliteTable("onboarding_state", {
  username: text("username").primaryKey(),
  // driver | individual (solo owner-operator) | owner
  mode: text("mode").notNull().default("driver"),
  // Dismissing onboarding records a done state — returning users are
  // never trapped in it or auto-shown it again.
  dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
  // The Owner Portal introduction (owner-saved copy) shows on first
  // entry to the Owner Portal only; this flag is the no-re-nag record.
  ownerIntroSeen: integer("owner_intro_seen", { mode: "boolean" }).notNull().default(false),
  stepsJson: text("steps_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Priority onboarding help requests, filed in-app and flagged for Ask
// Meca (owner requests carry the "owner_onboarding" flag). In-app guided
// help is real today; a human concierge follows at store launch — the
// request is stored and labelled staged, never answered by a fake human.
export const onboardingHelpRequests = sqliteTable("onboarding_help_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  topic: text("topic").notNull(), // owner_onboarding | driver_onboarding | eld | training | other
  flag: text("flag").notNull(),
  message: text("message").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Fleet trucks recorded by the white-glove import (Owner premium). The
// app had no truck roster before — a truck was only a count on the
// plan. Imported trucks live here, per company, with the owner's own
// unit labels. Production starts EMPTY.
export const fleetTrucks = sqliteTable("fleet_trucks", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  unitLabel: text("unit_label").notNull(),
  detail: text("detail"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Driver Profiles + STONEMILES Board (migration 0025, Pass 4) ----------
// The board is ONE fixed layout with ONE fixed set of areas, identical
// for every user — there is deliberately NO settings table, no theme,
// no custom-field storage for it anywhere. Posts are structured
// (title, body, area, city + state, area detail fields) and sealed
// into the hash chain (chain_hash stores the seal). Production starts
// EMPTY — no seeded posts or likes.
export const boardPosts = sqliteTable("board_posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  // One of the fixed areas: Milestones | Safety Lessons |
  // Fuel & Money Tips | Road Stories | Shout-Outs (enforced in actions).
  area: text("area").notNull(),
  // Location is CITY + STATE only — never a precise address, never raw
  // coordinates. locationSource says how it got there: the driver typed
  // it ("driver_entered") or it came from the GPS fix's reverse geocode
  // ("gps_derived", labelled as such wherever it shows).
  city: text("city").notNull(),
  state: text("state").notNull(),
  locationSource: text("location_source").notNull().default("driver_entered"),
  // Area detail fields: miles reached (Milestones posts) + one free
  // detail line fitting the area (a lesson, a saving, a shout-out to).
  milesReached: real("miles_reached"),
  detailText: text("detail_text"),
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  chainHash: text("chain_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One like per driver per post, removable (toggle). Likes are counts
// only — they are never sealed as records and never earn points.
export const boardLikes = sqliteTable("board_likes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").notNull(),
  username: text("username").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Guidance upgrade (migration 0040): saved places + recents --------
// Saved places are the driver's own favorites — home, yard, terminal,
// shipper, receiver, or a custom label. The street address (addressLabel
// + lat/lon) stays on the record; an OPTIONAL separate truck gate /
// entrance point (gateLat/gateLon) is what routing targets when set,
// because a semi enters at the gate, not the mailing address. Per-driver
// private data: never shared, never on a social profile, and wiped by
// the same one-tap delete-all as every other driver record.
export const savedPlaces = sqliteTable("saved_places", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // home | yard | terminal | shipper | receiver | custom
  category: text("category").notNull().default("custom"),
  addressLabel: text("address_label").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  gateLat: real("gate_lat"),
  gateLon: real("gate_lon"),
  gateLabel: text("gate_label"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Recent destinations: every place the driver actually routes to lands
// here (deduped by spot) so the next run is one tap. Gate coordinates
// ride along when the destination came from a saved place with a gate,
// so a re-route from recents still targets the gate. Private, per-driver,
// wiped by delete-all like everything else.
export const recentDestinations = sqliteTable("recent_destinations", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  gateLat: real("gate_lat"),
  gateLon: real("gate_lon"),
  useCount: integer("use_count").notNull().default(1),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Security Pack 2 (migration 0041) --------------------------------------
// Account-takeover protection, lost-phone kill switch, access/export
// audit, location privacy, and money-movement step-ups. Secrets follow
// the vault rules: the TOTP secret is AES-GCM encrypted at rest (same
// vault as the EIN), recovery codes and session tokens are stored as
// SHA-256 hashes only — plaintext leaves the server exactly once, at
// setup (recovery codes) or at session creation (the session token).

// Authenticator-app 2FA (TOTP, RFC 6238). One row per account. A row
// with enabled = false is a pending setup (secret generated, not yet
// confirmed with a valid code) — it protects nothing until confirmed.
export const totpCredentials = sqliteTable("totp_credentials", {
  username: text("username").primaryKey(),
  secretEnc: text("secret_enc").notNull(), // enc:v1:… (vault-encrypted base32 secret)
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
});

// One-time recovery codes for 2FA — SHA-256 hashes only. A code is
// consumed (used_at set) the first time it verifies; it never works twice.
export const recoveryCodes = sqliteTable("recovery_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  codeHash: text("code_hash").notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Server-side login sessions. A sign-in from a device the account has
// never used raises a security alert + a sealed security-log entry.
// Sign Out Everywhere / remote lock / member cut-off all work by
// setting revoked_at — a revoked token validates nowhere.
export const loginSessions = sqliteTable("login_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  deviceId: text("device_id").notNull(),
  deviceLabel: text("device_label").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

// In-app security alerts (new-device sign-ins and other account events
// the holder should see even if they missed the moment).
export const securityAlerts = sqliteTable("security_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  kind: text("kind").notNull(), // new_device | account_locked | member_cut_off | step_up_hold
  detail: text("detail").notNull(),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Lost-phone kill switch state: locked = the account is frozen by its
// holder (from another device). Lock and unlock are sealed events.
export const accountLocks = sqliteTable("account_locks", {
  username: text("username").primaryKey(),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
  reason: text("reason"),
});

// Step-up freshness: the last time this account proved a fresh PIN
// (valid 5 minutes) for sensitive areas — wallet, settlements, exports.
export const stepupState = sqliteTable("stepup_state", {
  username: text("username").primaryKey(),
  verifiedAt: integer("verified_at", { mode: "timestamp_ms" }).notNull(),
});

// Sealed access + export audit: every company-side (owner/dispatch)
// view of, or export of, a driver's records. The driver reads their own
// rows in "Who accessed my records". Mirrors into the hash chain too.
export const recordAccessLog = sqliteTable("record_access_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  viewerUsername: text("viewer_username").notNull(),
  subjectUsername: text("subject_username").notNull(),
  kind: text("kind").notNull(), // view | export
  what: text("what").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Raw GPS breadcrumb points (the un-sealed track). Retention-limited:
// the driver's setting (7 / 30 / 90 days, default 30) purges points
// older than the limit automatically. Sealed trip records, trip sheets,
// and summaries are NOT here and are never purged by this.
export const trackPoints = sqliteTable("track_points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
});

// Latest live position per driver (one row). Company-side reads go
// through the location-privacy rule: coordinates leave the server only
// while the driver is on duty or on an active trip.
export const driverPositions = sqliteTable("driver_positions", {
  username: text("username").primaryKey(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Per-account security preferences: auto-lock timer (minutes of
// inactivity; 0 = off) and raw-track retention (days).
export const securityPrefs = sqliteTable("security_prefs", {
  username: text("username").primaryKey(),
  autoLockMinutes: integer("auto_lock_minutes").notNull().default(0),
  trackRetentionDays: integer("track_retention_days").notNull().default(30),
  lastPurgeAt: integer("last_purge_at", { mode: "timestamp_ms" }),
});

// Money-movement Review Holds (Security Pack 2 step-up policy): a
// points-conversion or cash-out request at/above its threshold — or one
// tripping the velocity check — lands here in a plainly-shown
// "review_hold" state instead of processing. Creating a hold moves NO
// points and NO money; conversion/cash-out activation gates are
// untouched by this table.
export const moneyHolds = sqliteTable("money_holds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  kind: text("kind").notNull(), // conversion | cashout
  amountStoner: real("amount_stoner").notNull(),
  points: integer("points"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("review_hold"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Owner Giveaway Portal (migration 0063) ---------------------------------
// OWNER MONEY ONLY (locked by x, 2026-10-27): a company owner gives
// their OWN funds to their OWN company drivers. These tables never
// touch the Earning Pool, the Reward Wallet, or any platform giveaway
// table, and the app never holds owner funds — it records payouts the
// owner made from their own profile wallet, verifies them on
// Robinhood Chain (4663), and publishes the record (hash-chain events
// owner_giveaway_*). Recipients/entrants are ONLY the owner's company
// members with role "driver" (roster scoping enforced server-side on
// every action — see server/src/ownerGiveaway.ts).
export const ownerGiveaways = sqliteTable("owner_giveaways", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  ownerUsername: text("owner_username").notNull(),
  currency: text("currency").notNull(), // USDG | USD | STONER | ETH
  potAmount: real("pot_amount").notNull(), // major units
  mode: text("mode").notNull(), // selected | random
  winnerCount: integer("winner_count"), // random mode only
  status: text("status").notNull().default("draft"), // draft | funded | distributed | cancelled
  // Random mode: SHA-256 commitment sealed at creation over
  // {companyId, sorted entrants, pot, currency, winnerCount,
  // createdAt} — recomputable by anyone from the published record.
  commitmentHash: text("commitment_hash"),
  // Set at draw: how the seed was derived, the seed itself, and the
  // seal-chain head hash the seed was bound to.
  seedMethod: text("seed_method"),
  drawSeed: text("draw_seed"),
  drawHeadHash: text("draw_head_hash"),
  distributionNote: text("distribution_note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  fundedAt: integer("funded_at", { mode: "timestamp_ms" }),
  distributedAt: integer("distributed_at", { mode: "timestamp_ms" }),
});

// One row per recipient/entrant of an owner giveaway. In selected
// mode every row is a payee (isWinner true, amount = their share). In
// random mode every ENTRANT gets a row at creation (amount 0,
// isWinner false); the draw flips the winners to isWinner true with
// their equal share. payoutAddress is the driver's Robinhood Chain
// address as supplied/confirmed by the owner at creation — visible to
// the driver in their own view so a wrong address can be flagged
// before funding. txHash/verification/verifiedAmount carry the LATEST
// recorded payout: a failed verification never blocks recording a
// corrected hash; only "verified" counts toward funded.
export const ownerGiveawayRecipients = sqliteTable("owner_giveaway_recipients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  giveawayId: integer("giveaway_id").notNull(),
  username: text("username").notNull(),
  payoutAddress: text("payout_address").notNull(),
  amount: real("amount").notNull().default(0),
  isWinner: integer("is_winner", { mode: "boolean" }).notNull().default(false),
  txHash: text("tx_hash"),
  // verified | not_found | recipient_mismatch | unavailable
  verification: text("verification"),
  verifiedAmount: real("verified_amount"),
  recordedAt: integer("recorded_at", { mode: "timestamp_ms" }),
});

// First-party app performance timings (migration 0046): the app
// records its OWN measured timings — reroute elapsed time and route-
// request durations — so routing/GPS thresholds can be tuned from real
// drives. First-party only: written by the app itself, read back only
// by the same account, no third-party analytics or trackers. Per-trip
// GPS fix-quality aggregates live on the trips row (fix_quality);
// these rows are the event-level timings that happen with or without
// an active trip (trip_queue_id links one when a queue trip was live).
export const perfEvents = sqliteTable("perf_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  kind: text("kind", { enum: ["reroute", "route_request"] }).notNull(),
  durationMs: integer("duration_ms"),
  ok: integer("ok", { mode: "boolean" }),
  tripQueueId: integer("trip_queue_id"),
  // Small JSON detail object (e.g. {"fast":true,"options":3} for a
  // route request, {"offRouteMi":0.12} for a reroute). Never location.
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Pay Book entries (migration 0064): every paycheck the driver logs,
// tagged W-2 or 1099 — x's rule: tracked together (one combined
// keep-up total), filed separately (two piles, two tax packets).
// isForm rows record the year-end W-2 / 1099 FORM itself as received
// (payer + tax year + gross as printed) so the January paperwork ties
// to its pile; form rows never count in the pay totals. Withholding
// fields belong to the W-2 pile. The pay stub / form scan is a blob
// with a SHA-256 fingerprint, sealed like expense receipts.
export const payEntries = sqliteTable("pay_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // The driver whose Pay Book this entry belongs to (migration 0066):
  // the hand-logging driver, or the recipient for a company-sent
  // entry. Stub-file reads enforce it — another driver's entry file
  // is never served. Legacy rows were backfilled from the device
  // profile by the migration.
  username: text("username"),
  kind: text("kind", { enum: ["w2", "1099"] }).notNull(),
  isForm: integer("is_form", { mode: "boolean" }).notNull().default(false),
  payer: text("payer").notNull(),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }).notNull(),
  taxYear: integer("tax_year"),
  gross: real("gross").notNull(),
  federalWithheld: real("federal_withheld").notNull().default(0),
  stateWithheld: real("state_withheld").notNull().default(0),
  otherDeductions: real("other_deductions").notNull().default(0),
  // Itemized deduction lines (migration 0068): a stub in either lane
  // carries named deductions that came off before the pay landed
  // (fuel, truck payment, insurance, escrow, quickpay/service fees on
  // a 1099 settlement; 401(k), health insurance, child support, union
  // dues on a W-2 stub — never tax withholding in either lane).
  // Stored as a JSON array of {label, amount}; when lines are present
  // they sum EXACTLY into otherDeductions — one deductions number.
  // A W-2 entry with no lines keeps its lump otherDeductions figure;
  // year-end forms always carry null. Legacy rows read as no lines.
  deductionLines: text("deduction_lines"),
  // Per diem (migration 0067): non-taxable, paid to the driver on a
  // separate check. The printed gross on a per-mile stub is commonly
  // the TAXABLE gross after per diem was taken out, so per diem is
  // tracked apart — never added into filing gross, never deducted.
  // Form entries carry 0 (a form's per diem is ignored everywhere).
  perDiem: real("per_diem").notNull().default(0),
  notes: text("notes"),
  stubBlobKey: text("stub_blob_key"),
  stubMime: text("stub_mime"),
  stubSha256: text("stub_sha256"),
  // Where the entry came from: null = the driver logged it by hand;
  // "company" = it arrived as a company-sent stub delivery the driver
  // accepted (deliveryId names the pay_stub_deliveries row).
  source: text("source"),
  deliveryId: integer("delivery_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Pay-stub deliveries (migration 0065): an owner/dispatch sends a
// driver in their OWN company a W-2 pay stub or 1099 stub — or the
// year-end form itself — inside STONEMILES, before payday, instead of
// email. Sending itself is in-app only. Email enters only as the
// DRIVER's opt-in copy after they CONFIRM a stub into their Pay Book
// (payStubEmailEnabled, migration 0072 — default OFF; see
// pay_stub_email_deliveries), and a driver may always choose to email
// a copy of their own stub from their own mail app (see
// server/src/payStub.ts). Status: sent → accepted (files a
// Pay Book entry exactly once, payEntryId set) | flagged (driver says
// it looks wrong, flagReason shown to the sender; no entry) |
// withdrawn (sender only, and only while still "sent"). The stub file
// is a blob with a SHA-256 fingerprint, same as pay entries.
export const payStubDeliveries = sqliteTable("pay_stub_deliveries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  senderUsername: text("sender_username").notNull(),
  recipientUsername: text("recipient_username").notNull(),
  kind: text("kind", { enum: ["w2", "1099"] }).notNull(),
  deliveryType: text("delivery_type", { enum: ["stub", "form"] }).notNull(),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }).notNull(),
  taxYear: integer("tax_year"),
  gross: real("gross").notNull(),
  federalWithheld: real("federal_withheld").notNull().default(0),
  stateWithheld: real("state_withheld").notNull().default(0),
  otherDeductions: real("other_deductions").notNull().default(0),
  // Itemized 1099 deduction lines (migration 0068), same JSON shape
  // as pay_entries.deduction_lines — an accepted 1099 stub files its
  // Pay Book entry with these lines intact, exactly once.
  deductionLines: text("deduction_lines"),
  // Per diem carried on the delivery (migration 0067) — an accepted
  // stub files its Pay Book entry with this intact; form deliveries
  // store 0 and ignore it.
  perDiem: real("per_diem").notNull().default(0),
  notes: text("notes"),
  stubBlobKey: text("stub_blob_key"),
  stubMime: text("stub_mime"),
  stubSha256: text("stub_sha256"),
  status: text("status", { enum: ["sent", "accepted", "flagged", "withdrawn"] })
    .notNull()
    .default("sent"),
  flagReason: text("flag_reason"),
  payEntryId: integer("pay_entry_id"),
  sentAt: integer("sent_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  respondedAt: integer("responded_at", { mode: "timestamp_ms" }),
});

// ---- Shipper Portal (migration 0069) ---------------------------------------
// A shipper company the RUGGS LOGISTICS desk invited to the portal.
// `linkedUsername` is the STONEMILES account (email-login account system)
// that signs in AS this shipper — the portal resolves the caller's
// shipper from this link server-side, never from a client-supplied id,
// so a shipper session can only ever read its own loads (the same
// server-side scoping standard as the Pay Book roster). The desk
// (Owner/Dispatch of the fleet company) owns the account: it can
// suspend it without touching the board or other shippers. `isDemo`
// marks staging/demo accounts so demo data is always labelled as such.
export const shipperAccounts = sqliteTable("shipper_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  contactName: text("contact_name"),
  // Short monogram shown in the portal header beside the shipper name
  // (the light white-label: name + monogram, no theme engine in v1).
  logoInitials: text("logo_initials"),
  linkedUsername: text("linked_username"),
  companyId: integer("company_id"),
  ownerUsername: text("owner_username").notNull(),
  status: text("status").notNull().default("active"), // active | suspended
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  defaultPickupAddress: text("default_pickup_address"),
  defaultPickupCity: text("default_pickup_city"),
  defaultPickupState: text("default_pickup_state"),
  defaultCommodity: text("default_commodity"),
  defaultFreightClass: text("default_freight_class"),
  defaultContactName: text("default_contact_name"),
  defaultContactPhone: text("default_contact_phone"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One load a shipper posted through the portal. Lifecycle:
// draft → sent (With dispatch) → released (a board_loads row exists —
// from there the plain status is derived live from the board row and
// its claimed driver load: On the board / Carrier assigned / Picked
// up / In transit / Delivered) or returned (back to the shipper with
// the desk's note; editable and re-sendable). Draft/returned loads
// never reach the board and never spawn anything. The rate
// confirmation is a blob fingerprinted with SHA-256 like every load
// document. NO payment or fee field exists on this table by design:
// the portal takes no payments and no shipper-facing shape may carry
// dispatch-fee or internal percentage information.
export const shipperLoads = sqliteTable("shipper_loads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shipperId: integer("shipper_id").notNull(),
  companyId: integer("company_id"),
  createdBy: text("created_by").notNull(),
  referenceNumber: text("reference_number"),
  pickupAddress: text("pickup_address"),
  pickupCity: text("pickup_city"),
  pickupState: text("pickup_state"),
  pickupDate: text("pickup_date"),
  pickupWindow: text("pickup_window"),
  deliveryAddress: text("delivery_address"),
  deliveryCity: text("delivery_city"),
  deliveryState: text("delivery_state"),
  deliveryDate: text("delivery_date"),
  deliveryWindow: text("delivery_window"),
  commodity: text("commodity"),
  freightClass: text("freight_class"),
  weightLbs: integer("weight_lbs"),
  pieces: integer("pieces"),
  dimensions: text("dimensions"),
  equipment: text("equipment"), // flatbed | step_deck | rgn
  tarps: integer("tarps", { mode: "boolean" }).notNull().default(false),
  edgeProtectors: integer("edge_protectors", { mode: "boolean" }).notNull().default(false),
  rate: real("rate"),
  rateConBlobKey: text("rate_con_blob_key"),
  rateConMime: text("rate_con_mime"),
  rateConSha256: text("rate_con_sha256"),
  signoffConfirmed: integer("signoff_confirmed", { mode: "boolean" }).notNull().default(false),
  offloadConfirmed: integer("offload_confirmed", { mode: "boolean" }).notNull().default(false),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
  // draft | sent | returned | released
  status: text("status").notNull().default("draft"),
  boardLoadId: integer("board_load_id"),
  // Unguessable view-only tracking token, minted at release: anyone
  // holding it sees the state-level tracking summary and nothing else.
  trackToken: text("track_token"),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Confirmed-document copies: filed copy + email copies (migration 0070) --
// X's order (2026-10-30): a copy of any CONFIRMED load-document upload
// (rate con / BOL at booking, the pickup BOL once its details are
// confirmed, and the POD at delivery seal) is emailed to the driver,
// dispatch, and the owner / fleet owner, and a copy is saved in the
// uploading user's files. Filing is the in-app half and always lands;
// email delivery is recorded per recipient in doc_email_deliveries with
// an honest status (sent only when the mail provider actually accepted
// it; queued while no provider is connected; no_address when that seat
// has no email on file; off when copies are turned off).
// BOTH EMAIL PATHS OPTIONAL (x, 2026-10-30, migration 0072): the load-
// document email above stays controlled by `enabled` (default ON), and
// pay stubs gain their OWN toggle, `payStubEmailEnabled` (default
// OFF — the driver opts in). When the pay-stub toggle is ON, a copy of
// a CONFIRMED pay stub (a scanned stub the driver logs into their Pay
// Book, or a company stub the driver accepts into their Pay Book) is
// emailed to the same three seats and recorded in
// pay_stub_email_deliveries. When it is OFF, pay stubs stay in-app
// only exactly as before, and the driver can still share a stub from
// their own mail app / share sheet. Filing a copy in the user's files
// (the Pay Book entry itself, for stubs) is never gated by either
// toggle.
export const docCopySettings = sqliteTable("doc_copy_settings", {
  id: integer("id").primaryKey(),
  // Per-user settings (migration 0071): one row per username, keyed by
  // the row's owner. A confirmation always resolves recipients from the
  // FILING user's own row — one account's addresses can never govern
  // another account's documents. Dispatch/owner addresses in a company
  // row are writable only by Owner/Dispatch seats (enforced in
  // saveDocCopySettings); a driver edits only their own driver email.
  username: text("username").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // Pay-stub email copies (migration 0072): SEPARATE toggle, default
  // OFF. The driver opts in; load-document copies never read it and
  // pay-stub copies never read `enabled` — the two paths are
  // independent, exactly as x ordered ("both optional also").
  payStubEmailEnabled: integer("pay_stub_email_enabled", { mode: "boolean" }).notNull().default(false),
  driverEmail: text("driver_email"),
  dispatchEmail: text("dispatch_email"),
  ownerEmail: text("owner_email"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One row per confirmed document filed into the user's Files. The blob
// is the copy itself: booking documents get their own byte copy
// (ownsBlob = true); pickup-BOL / POD copies reference the sealed
// pickup photo blob (ownsBlob = false — the load owns that blob, and
// deleting the filed copy never deletes the load's proof).
export const filedDocCopies = sqliteTable("filed_doc_copies", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  docKind: text("doc_kind").notNull(), // rate_con | bol | pod | load_sheet | load_document
  label: text("label").notNull(),
  blobKey: text("blob_key"),
  ownsBlob: integer("owns_blob", { mode: "boolean" }).notNull().default(false),
  mime: text("mime"),
  sha256: text("sha256").notNull(),
  source: text("source").notNull(), // load_doc | pickup_bol | pod_seal
  filedBy: text("filed_by").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One row per (filed copy, recipient seat): the email-copy record.
// Status: sent | queued | no_address | off | failed. A row is only
// ever "sent" with a provider id from the mail transport.
export const docEmailDeliveries = sqliteTable("doc_email_deliveries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  filedCopyId: integer("filed_copy_id"),
  docKind: text("doc_kind").notNull(),
  recipientRole: text("recipient_role").notNull(), // driver | dispatch | owner
  recipientEmail: text("recipient_email"),
  recipientUsername: text("recipient_username"),
  status: text("status").notNull(),
  detail: text("detail"),
  providerId: text("provider_id"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
});

// Receive links (migration 0112): the per-load capability tokens for
// the delivery close-out. kind "action" = the receive link printed as
// a QR on the BOL — the receiver confirms delivery with it, once.
// kind "copy" = the receiver's own view-only POD copy link (separate
// token, no action rights). One active token per (load, kind); the
// desk regenerates by revoking the old row and issuing a new one.
// Global table (no profile_id): public lookups resolve by token
// alone, exactly like chain_log rows resolve by id.
export const receiveLinks = sqliteTable("receive_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  token: text("token").notNull().unique(),
  kind: text("kind").notNull().default("action"), // action | copy
  status: text("status").notNull().default("active"), // active | used | revoked
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

// Pay-stub email copies (migration 0072): one row per (confirmed pay
// entry, recipient seat), written ONLY when the driver has opted in
// (doc_copy_settings.payStubEmailEnabled). A row names the Pay Book
// entry it copied (payEntryId) and, for a company-sent stub, the
// delivery it came from (deliveryId). Status/detail/provider rules
// are the load-document rules verbatim (sent only with a provider
// id; queued while no provider is connected; no_address when a seat
// has no email on file; failed with a re-send). This table holds NO
// stub file and NO pay figures beyond the payer label the email
// itself carried — the stub stays sealed in the Pay Book entry.
export const payStubEmailDeliveries = sqliteTable("pay_stub_email_deliveries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  payEntryId: integer("pay_entry_id"),
  deliveryId: integer("delivery_id"),
  kind: text("kind").notNull(), // w2 | 1099
  isForm: integer("is_form", { mode: "boolean" }).notNull().default(false),
  payer: text("payer").notNull(),
  recipientRole: text("recipient_role").notNull(), // driver | dispatch | owner
  recipientEmail: text("recipient_email"),
  recipientUsername: text("recipient_username"),
  status: text("status").notNull(),
  detail: text("detail"),
  providerId: text("provider_id"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
});

// ---- Library document sends (migration 0111) -------------------------------
// One row per user-initiated document email out of the User Library
// (statements, IFTA state lines + filings, sealed load records,
// delivered-load packets, uploads). The row is BOTH the audit trail
// and the queue (D1 mechanics): it reads "sent" only with a provider
// id back from the mail transport; unconfigured transport leaves it
// "queued" — nothing is ever reported sent without a provider id.
// The matching sealed record is the document_emailed chain event.
export const documentSends = sqliteTable("document_sends", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read — see host/ctx.ts scopedDb).
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  docRef: text("doc_ref").notNull(),
  docKind: text("doc_kind").notNull(), // settlement | pay | ifta | filing | sealed | packet | upload
  docTitle: text("doc_title").notNull(),
  toEmail: text("to_email").notNull(),
  replyTo: text("reply_to"),
  subject: text("subject").notNull(),
  status: text("status").notNull(), // queued | sent | failed
  providerId: text("provider_id"),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
});

// ---- OS/OW permits (migration 0097) ---------------------------------------
// A state oversize/overweight permit the driver scanned (or typed) and
// CONFIRMED field by field — nothing files off an unconfirmed read, the
// same confirm-before-save rule as every other document in the app.
// The docket is stored EXACTLY as confirmed: routeSteps is the ordered
// approved-route road sequence as printed on the permit (JSON array of
// lines, verbatim), routePlaces the ordered named places on that route
// (used only to MATCH the printed route to the road network for Permit
// route navigation — matched geometry is derived, never the state's),
// dimensions ride both as printed (text) and as numbers when the read
// reported them plainly. Status (active / upcoming / expired /
// completed) is DERIVED from validFrom/validTo/completedAt — never a
// stored flag that can drift from the dates. The scanned document's
// bytes seal here (docBlobKey/docSha256); when the permit is attached
// to a load, a copy also files into filed_doc_copies (filedCopyId) —
// with NO email copies: permits never send mail (x's order for this
// build — mail stays staged/queued app-wide).
export const permits = sqliteTable("permits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  loadId: integer("load_id"),
  permitNumber: text("permit_number"),
  issuingState: text("issuing_state"),
  issuingAgency: text("issuing_agency"),
  routeSteps: text("route_steps").notNull(), // JSON string[]
  routePlaces: text("route_places").notNull(), // JSON string[]
  heightText: text("height_text"),
  widthText: text("width_text"),
  lengthText: text("length_text"),
  weightText: text("weight_text"),
  heightIn: real("height_in"),
  widthIn: real("width_in"),
  lengthIn: real("length_in"),
  weightLbs: real("weight_lbs"),
  validFrom: text("valid_from"), // YYYY-MM-DD as printed/confirmed
  validTo: text("valid_to"), // YYYY-MM-DD as printed/confirmed
  escorts: text("escorts"),
  curfews: text("curfews").notNull(), // JSON string[]
  restrictions: text("restrictions").notNull(), // JSON string[]
  qrText: text("qr_text"),
  docBlobKey: text("doc_blob_key"),
  docMime: text("doc_mime"),
  docSha256: text("doc_sha256"),
  filedCopyId: integer("filed_copy_id"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Broker Portal — poster accounts + loads (migration 0073) -------------
// A broker company the RUGGS LOGISTICS desk invited to post loads to
// the OPEN board (x, 2026-10-30). Same desk-invited pattern as the
// Shipper Portal: `linkedUsername` is the STONEMILES account that
// signs in AS this broker — the portal resolves the caller's broker
// from this link server-side, never from a client-supplied id, so a
// broker session can only ever read its own loads. The desk can
// suspend an account without touching the board or other brokers.
export const brokerAccounts = sqliteTable("broker_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  contactName: text("contact_name"),
  // Short monogram shown beside the broker name (name + logo in v1).
  logoInitials: text("logo_initials"),
  // The brokerage's MC number, when it has one — the durable broker
  // identity the released board post and the claimed load carry.
  brokerMc: text("broker_mc"),
  // Dispatcher fee % override (migration 0088): THIS poster
  // account's own dispatcher fee, set by the poster (or the desk
  // that manages the account), capped at 20 server-side. Null =
  // unset: a poster linked to a dispatch company inherits that
  // company's fee; otherwise no fee (0%). Snapshotted onto the
  // board row at release and shown before claiming — see
  // companies.dispatcherFeePct for the full rule.
  dispatcherFeePct: real("dispatcher_fee_pct"),
  linkedUsername: text("linked_username"),
  companyId: integer("company_id"),
  ownerUsername: text("owner_username").notNull(),
  status: text("status").notNull().default("active"), // active | suspended
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  defaultPickupAddress: text("default_pickup_address"),
  defaultPickupCity: text("default_pickup_city"),
  defaultPickupState: text("default_pickup_state"),
  defaultCommodity: text("default_commodity"),
  defaultFreightClass: text("default_freight_class"),
  defaultContactName: text("default_contact_name"),
  defaultContactPhone: text("default_contact_phone"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One load a broker posted through the Broker Portal. Lifecycle is
// the Shipper Portal's: draft → sent (With dispatch) → released (an
// OPEN board_loads row exists) or returned (back to the broker with
// the desk's note; editable and re-sendable). Draft/returned loads
// never reach any board. The rate confirmation is a blob fingerprinted
// with SHA-256 like every load document. NO payment or fee field
// exists on this table by design: freight pay runs DIRECT from the
// broker to the claiming carrier — RUGGS LLC never holds it — and no
// broker-facing shape may carry dispatch-fee information. The one fee
// in the lane (the claiming carrier's RUGGS LLC dispatch fee on an Open
// Board claim) is invoiced to the CARRIER at sealed delivery under
// the existing settle-to-claim rules, exactly like a fleet-board
// claim, once per load.
export const brokerPosterLoads = sqliteTable("broker_poster_loads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brokerId: integer("broker_id").notNull(),
  companyId: integer("company_id"),
  createdBy: text("created_by").notNull(),
  referenceNumber: text("reference_number"),
  pickupAddress: text("pickup_address"),
  pickupCity: text("pickup_city"),
  pickupState: text("pickup_state"),
  pickupDate: text("pickup_date"),
  pickupWindow: text("pickup_window"),
  deliveryAddress: text("delivery_address"),
  deliveryCity: text("delivery_city"),
  deliveryState: text("delivery_state"),
  deliveryDate: text("delivery_date"),
  deliveryWindow: text("delivery_window"),
  commodity: text("commodity"),
  freightClass: text("freight_class"),
  weightLbs: integer("weight_lbs"),
  pieces: integer("pieces"),
  dimensions: text("dimensions"),
  equipment: text("equipment"), // flatbed | step_deck | rgn
  tarps: integer("tarps", { mode: "boolean" }).notNull().default(false),
  edgeProtectors: integer("edge_protectors", { mode: "boolean" }).notNull().default(false),
  rate: real("rate"),
  rateConBlobKey: text("rate_con_blob_key"),
  rateConMime: text("rate_con_mime"),
  rateConSha256: text("rate_con_sha256"),
  signoffConfirmed: integer("signoff_confirmed", { mode: "boolean" }).notNull().default(false),
  offloadConfirmed: integer("offload_confirmed", { mode: "boolean" }).notNull().default(false),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
  // draft | sent | returned | released
  status: text("status").notNull().default("draft"),
  boardLoadId: integer("board_load_id"),
  trackToken: text("track_token"),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Team Portal — developer / support seats (migration 0074) -------------
// PLATFORM-level support access, separate from every company seat.
// SEAT ACCESS (owner's lock, 2026-10-30, migration 0077): the owner is
// the ONLY seat holder until he approves an addition, and a new seat
// is granted ONLY by redeeming an owner-issued team invite code (the
// team_invite_codes table below) — direct grants by username are
// closed. Team seats exist so the developers /
// support team can fix account-level problems for users — and ONLY
// account-level problems. The team actions (server/src/actions.ts,
// "Team Portal" section) are gated on an ACTIVE row here and return
// account SHELLS only: display name, account type, tier, company,
// seats, account status, signup date. No team action ever selects a
// Pay Book row, a pay stub, a document/photo blob, load paperwork
// contents, a chat/message row, a password/PIN hash, a wallet key, a
// seed phrase, or a payment credential — those fields are never read,
// so they can never leak. There is NO impersonation: no team action
// can act as, or sign in as, another user.
export const teamSeats = sqliteTable("team_seats", {
  username: text("username").primaryKey(),
  role: text("role").notNull().default("support"), // developer | support
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  grantedBy: text("granted_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Team invite codes (migration 0077, owner's lock 2026-10-30): the
// ONLY path to a new team seat besides the owner's own seat. The
// owner generates a code in the app (his explicit approval action),
// tied to ONE specific email address; the invited developer redeems
// it from the account whose email on file matches that address, and
// redemption creates the seat. Single-use: status flips pending →
// redeemed exactly once (revoked/expired are the other ends). The
// code format is its own namespace — TEAM-XXXX-XXXX-XXXX — distinct
// from referral codes (MILE-REF-…), beta/driver codes (MILE-…), and
// the owner code; those tables are never read by redemption, and this
// table is never read by any other redemption. granted_by on the
// seat row a redemption creates is the issuing owner (issued_by here).
export const teamInviteCodes = sqliteTable("team_invite_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  email: text("email").notNull(), // normalized lowercase at issuance
  role: text("role").notNull().default("support"), // developer | support
  issuedBy: text("issued_by").notNull(), // the owner's username
  status: text("status").notNull().default("pending"), // pending | redeemed | revoked | expired
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  redeemedBy: text("redeemed_by"),
  redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }),
});

// The visible admin audit log for the Team Portal: EVERY team action
// (seat grants/revokes, account views, tier/seat edits, unlocks, beta
// grants/revokes, status changes, invite resends, portal-account
// approvals/suspensions) writes one row — who acted, which account,
// what changed, when. Team members read it in the portal; rows are
// never edited or deleted, and every entry is also mirrored into the
// sealed hash chain (event "team_action").
export const teamAuditLog = sqliteTable("team_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUsername: text("actor_username").notNull(),
  action: text("action").notNull(), // grant_seat | revoke_seat | view_account | set_tier | set_seats | unlock_account | set_status | set_beta_access | resend_invite | portal_account_status
  targetUsername: text("target_username"),
  detail: text("detail").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Team-managed account overlay: the fields the Team Portal may set on
// ANY account (tier, fleet seats, beta/trial access, account status).
// Null = "the team has never set this — the shell derives it from the
// account's own records". For THIS install's own account the team
// actions ALSO write through to the live records (profile plan/seats,
// beta_access, account_locks, company member login flags) so the fix
// takes effect in the app itself, not just in the overlay.
export const accountAdmin = sqliteTable("account_admin", {
  username: text("username").primaryKey(),
  tier: text("tier"), // basic | gold | diamond | owner
  trucks: integer("trucks"),
  dispatchSeats: integer("dispatch_seats"),
  betaAccess: integer("beta_access", { mode: "boolean" }),
  status: text("status"), // active | suspended
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Team Portal expansion (migration 0075, owner expansion 2026-10-30) ----
// Team seats also work BOTH load boards (open + private fleet) to keep
// double booking from standing, host giveaways on the giveaway board,
// and send SM Points / $STONER — always inside the same wall (no Pay
// Book, stubs, paperwork contents, messages, passwords, seeds, or any
// personal sensitive information beyond what these features need).
// A flag the team put on a board load (e.g. a suspected double
// booking) — visible to the team until cleared; the flag itself is a
// team_audit_log entry too.
export const teamBoardFlags = sqliteTable("team_board_flags", {
  boardLoadId: integer("board_load_id").primaryKey(),
  flaggedBy: text("flagged_by").notNull(),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Platform giveaways the TEAM hosts on the giveaway board — same rules
// as the Owner Giveaway portal: created as a draft (random mode seals
// its commitment at creation), funded ONLY from a verified source
// ($STONER campaigns fund against the Reward Wallet's real balance;
// USD campaigns stay gated on the payment rails and cannot fund until
// those rails are live), then drawn (random mode) and distributed —
// distribution pays winners from the Reward Wallet ledger with a
// unique ref key per recipient, so a winner can never be paid twice.
export const teamGiveaways = sqliteTable("team_giveaways", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdBy: text("created_by").notNull(),
  currency: text("currency").notNull(), // STONER | USD
  potAmount: real("pot_amount").notNull(),
  mode: text("mode").notNull(), // selected | random
  winnerCount: integer("winner_count"),
  status: text("status").notNull().default("draft"), // draft | funded | distributed | cancelled
  commitmentHash: text("commitment_hash"),
  seedMethod: text("seed_method"),
  drawSeed: text("draw_seed"),
  drawHeadHash: text("draw_head_hash"),
  fundingSource: text("funding_source"),
  distributionNote: text("distribution_note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  fundedAt: integer("funded_at", { mode: "timestamp_ms" }),
  distributedAt: integer("distributed_at", { mode: "timestamp_ms" }),
});

export const teamGiveawayRecipients = sqliteTable("team_giveaway_recipients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  giveawayId: integer("giveaway_id").notNull(),
  username: text("username").notNull(),
  payoutAddress: text("payout_address").notNull(),
  amount: real("amount").notNull().default(0),
  isWinner: integer("is_winner", { mode: "boolean" }).notNull().default(false),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
});

// Transparency notices (owner expansion): EVERY change the team makes
// to an account lands here for the affected user — an in-app notice
// (read in the app, on the Driver tab) AND an email through the same
// doc-copy mail transport (sent only with a provider id; queued while
// no provider is connected; no_address when the account has no email
// on file). The row records the email outcome honestly; the in-app
// notice exists regardless of email.
export const teamChangeNotices = sqliteTable("team_change_notices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(), // the affected account
  actorUsername: text("actor_username").notNull(), // the team seat
  summary: text("summary").notNull(),
  detail: text("detail").notNull().default(""),
  // The team's own mailbox this notice is addressed from/for the team
  // under (migration 0078) — stonervisionteam@gmail.com. Recorded on
  // every notice so the provenance of a team change names the team
  // address, separate from the affected user's own email.
  teamEmail: text("team_email").notNull().default("stonervisionteam@gmail.com"),
  emailStatus: text("email_status").notNull().default("queued"), // sent | queued | no_address | failed
  emailDetail: text("email_detail").notNull().default(""),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Consent requests (owner expansion): help with a PASSWORD or PERSONAL
// INFORMATION runs ONLY on the user's explicit in-app approval,
// recorded BEFORE any change. The team creates a request naming
// exactly what would change (for personal info, the exact field values
// in fields_json); the user approves or denies it in the app; only an
// APPROVED, not-yet-applied request can be applied, once. The team
// never sees or sets a password: an approved password request lets the
// team TRIGGER the reset (PIN cleared + sessions revoked) and the user
// sets their own new PIN through the app's own flow.
export const teamConsentRequests = sqliteTable("team_consent_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  targetUsername: text("target_username").notNull(),
  requestedBy: text("requested_by").notNull(),
  kind: text("kind").notNull(), // password_reset | personal_info
  detail: text("detail").notNull().default(""),
  fieldsJson: text("fields_json"), // personal_info: JSON {field: newValue}
  status: text("status").notNull().default("pending"), // pending | approved | denied | consumed
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
});

// Consent-gated sensitive help (x, 2026-10-30): the sensitive wall
// (Pay Book entries, pay stubs, paperwork/documents) stands by default.
// A user may open a consent WINDOW for ONE specific item to ONE named
// team seat for 30 minutes — view-first; editing needs its own
// separate approval flag (canEdit) set by the USER in the same flow.
// A team request opens nothing and names the item only in words
// (description); the user binds the window to the actual item
// (itemId/itemLabel) when they approve, from inside their own account.
// Approval by phone or email does not exist. The window closes on its
// own at expiry and is revocable instantly by the user. ABSOLUTE
// exceptions — no consent can ever open the password itself, seed
// phrases, or payment credentials: item_kind's closed set
// (pay_entry | pay_stub | document) has no value for them.
export const teamItemConsentWindows = sqliteTable("team_item_consent_windows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  targetUsername: text("target_username").notNull(),
  teamSeat: text("team_seat").notNull(),
  itemKind: text("item_kind").notNull(), // pay_entry | pay_stub | document
  description: text("description").notNull().default(""),
  note: text("note"),
  itemId: integer("item_id"), // bound by the user at approval
  itemLabel: text("item_label"), // server-derived at approval
  canEdit: integer("can_edit", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("pending"), // pending | active | denied | revoked | expired
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  closeoutSentAt: integer("closeout_sent_at", { mode: "timestamp_ms" }),
});

// Session record of one consent window: every view and edit the named
// seat made inside the window. Shown to the user in-app and emailed
// when the window closes (same honest mail staging as other notices).
export const teamItemAccessLog = sqliteTable("team_item_access_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  windowId: integer("window_id").notNull(),
  seat: text("seat").notNull(),
  accessKind: text("access_kind").notNull(), // view | edit
  detail: text("detail").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- STONEMILES SI — Super Intelligent layer (2026-11-01) -------------------
// The autonomous back-office under the 8 SI Rules (server/src/si.ts).
// si_settings is the single-row master switch + the rules version the
// driver set in stone. si_vetting_checks holds pre-post vetting of
// brokers / shippers / owners / loads from PUBLIC business identifiers
// only (name + MC / USDOT) — no personal-data column exists in any SI
// table by design (Rule 1). si_events is the autonomy log: prep work
// SI did on its own (trip-sheet preps, fuel-plan chases, paperwork
// filings), bad-data corrections (new entries, never rewrites), and
// the decisions SI surfaces — the only things a human is asked for.
export const siSettings = sqliteTable("si_settings", {
  id: integer("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  rulesVersion: text("rules_version").notNull().default("2026-11-01"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const siVettingChecks = sqliteTable("si_vetting_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(), // broker | shipper | owner | carrier | load
  entityName: text("entity_name"),
  mcNumber: text("mc_number"),
  dotNumber: text("dot_number"),
  boardLoadId: integer("board_load_id"),
  loadId: integer("load_id"),
  verdict: text("verdict").notNull(), // clear | review | hold
  flagsJson: text("flags_json").notNull().default("[]"),
  saferUrl: text("safer_url"),
  summary: text("summary").notNull().default(""),
  // Human decision on a flagged check: pending | approved | held.
  // A "clear" check needs no decision and is stored as "approved"
  // (it may post); review/hold wait for the driver/desk.
  decision: text("decision").notNull().default("pending"),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const siEvents = sqliteTable("si_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // trip_prep | fuel_plan | paperwork | data_correction | road_heal | vetting | decision
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  // done (SI handled it, FYI only) | needs_decision (waiting on the
  // driver) | resolved (the driver decided) | dismissed
  status: text("status").notNull().default("done"),
  // Dedupe key so a repeat sweep never duplicates the same prep/flag.
  dedupeKey: text("dedupe_key").unique(),
  refKind: text("ref_kind"),
  refId: integer("ref_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
});

// ---- App health: self-reporting + live updates (2026-11-05) -----------------
// Owner order: the app reports its own crashes/failures automatically
// so the AI can diagnose, draft a fix, and give the owner live
// updates — while the owner stays the approval gate and fixes ship
// through Play (the app never rewrites its own code). See
// server/src/appHealth.ts for the rules this storage serves.
// app_health_settings is the single-row switch (auto-report ON by
// the owner's approval; the owner can turn it off any time — while
// off, automatic reports are dropped server-side, manual reports
// still land). app_health_reports is the failure inbox: one row
// per fingerprint, occurrences counted, travelling the fix
// pipeline (open → diagnosed → fix_drafted → tested → approved →
// shipped / resolved / dismissed). Reports carry sanitized error
// text + a screen name ONLY — no location column, no document
// column, no personal-data column exists by design.
// app_live_updates is the owner's live feed: health checks,
// reports, diagnoses, and pipeline moves narrated as they happen.
export const appHealthSettings = sqliteTable("app_health_settings", {
  id: integer("id").primaryKey(),
  autoReportEnabled: integer("auto_report_enabled", { mode: "boolean" }).notNull().default(true),
  lastCheckAt: integer("last_check_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const appHealthReports = sqliteTable("app_health_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fingerprint: text("fingerprint").notNull().unique(),
  // crash | error | unhandled_rejection | action_failed | health_check | manual
  kind: text("kind").notNull(),
  severity: text("severity").notNull(), // info | warning | critical
  title: text("title").notNull(),
  detail: text("detail"),
  screen: text("screen"),
  occurrences: integer("occurrences").notNull().default(1),
  // open | diagnosed | fix_drafted | tested | approved | shipped | resolved | dismissed
  status: text("status").notNull().default("open"),
  diagnosis: text("diagnosis"),
  fixPlan: text("fix_plan"), // JSON array of fix-plan steps, once drafted
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
});

export const appLiveUpdates = sqliteTable("app_live_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // health_check | crash_report | report | diagnosis | pipeline | settings | data_refresh
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  reportId: integer("report_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Reputation Passport sharing prefs — OFF by default; the driver picks
// exactly which verified stats appear on the shareable card.
export const passportPrefs = sqliteTable("passport_prefs", {
  id: integer("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  showMiles: integer("show_miles", { mode: "boolean" }).notNull().default(true),
  showOnTime: integer("show_on_time", { mode: "boolean" }).notNull().default(true),
  showSafety: integer("show_safety", { mode: "boolean" }).notNull().default(true),
  showSeasons: integer("show_seasons", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Money & Flow batch (migration 0102) ------------------------------------
// Records only — nothing in this batch moves money, sends an invoice,
// dispatches help, or files a tax return. Every row is the driver's
// own record, sealed into the hash chain at write time where the
// pattern calls for it (payments, claim events, breakdown logs).

// Payments the driver records against a delivered load — the "paid"
// half of the Who-owes-me board. A load leaves the board when the
// payments recorded against it cover what it's owed (freight +
// sealed claim events). The app never collects this money; the
// driver records that it arrived (check, ACH, factoring — the note
// says how). Partial payments are normal and stay visible.
export const loadPayments = sqliteTable("load_payments", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id").notNull(),
  amount: real("amount").notNull(),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }).notNull(),
  note: text("note"),
  chainHash: text("chain_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Claim events beside Detention Pay (which stays its own sealed
// arrival/departure system): TONU (truck ordered, not used), layover,
// and driver assist. One tap + the amount the DRIVER enters — the app
// never sets or suggests a claim amount. Each event seals into the
// load's chain record (refKind "load" when a load is attached) and
// rides the load's exports; an event with no load attached is a
// standalone claim record (e.g. a TONU where no load ever existed).
export const claimEvents = sqliteTable("claim_events", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  loadId: integer("load_id"),
  kind: text("kind").notNull(), // tonu | layover | driver_assist
  amount: real("amount").notNull(),
  note: text("note"),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  chainHash: text("chain_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Odometer-based maintenance countdown: one row per service item the
// driver tracks (oil | tires | brakes | dot_inspection). Intervals
// are DRIVER-SET — the defaults offered in the UI are labelled
// defaults, and this table only ever holds what the driver saved.
// last_done_odometer is the odometer at the last service; the
// countdown compares it against the newest odometer the app already
// records (fuel purchases, DVIRs, daily logs). The DOT annual can
// also run date-based (interval 0 = the 12-month rule).
export const maintenanceServices = sqliteTable("maintenance_services", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  item: text("item").notNull().unique(), // oil | tires | brakes | dot_inspection
  intervalMiles: real("interval_miles").notNull(),
  lastDoneOdometer: real("last_done_odometer"),
  lastDoneAt: integer("last_done_at", { mode: "timestamp_ms" }),
  note: text("note"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Breakdown downtime + cost log: one row per breakdown, opened when
// the truck goes down and closed when it's rolling again. Costs are
// the driver's own entries (JSON [{label, amount}] — tow, repair,
// hotel, tire…). Sealed at open and at close; exportable as the
// warranty/claim record. It logs and locates — it never dispatches
// or pays anyone (the Drive-screen Breakdown sheet does the locating
// from the same map data the app already uses).
export const breakdownLogs = sqliteTable("breakdown_logs", {
  // Auth Phase 2b: owning profile (host-stamped on insert, host-filtered
  // on read/update/delete — see host/ctx.ts scopedDb). Null only on
  // pre-auth rows; migration 0108 backfills them to profile 1.
  profileId: integer("profile_id"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  locationNote: text("location_note"),
  note: text("note"),
  costsJson: text("costs_json").notNull().default("[]"),
  chainHash: text("chain_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---- Auth (Phase 2b, migration 0108 — AUTH-DESIGN.md §4) -------------------
// Real sign-in for the standalone host. accounts is the credential +
// identity record; profile stays the app-data record (account ≠ profile,
// §2.1). Passwords exist ONLY as Argon2id PHC strings (Bun.password);
// session/reset/invite tokens exist ONLY as SHA-256 hashes. Plaintext
// tokens leave the server exactly once (email link / operator terminal).

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Normalized (trim + NFC + lowercase) sign-in email — the lookup key.
  email: text("email").notNull().unique(),
  // PHC Argon2id string from Bun.password.hash. NULL while invited —
  // no password has ever been set; there is NO default password, ever.
  passwordHash: text("password_hash"),
  // invited | active | locked | disabled (§2.3)
  status: text("status").notNull().default("invited"),
  // The platform owner's account (profile 1). Exactly one row — the
  // partial unique index in migration 0108 enforces it structurally.
  isOwner: integer("is_owner", { mode: "boolean" }).notNull().default(false),
  failedSignins: integer("failed_signins").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  emailVerifiedAt: integer("email_verified_at", { mode: "timestamp_ms" }),
  lastSigninAt: integer("last_signin_at", { mode: "timestamp_ms" }),
  // Founding Tester / trial bookkeeping (D4/D5): the invite kind that
  // created this account and when its entitlement window started.
  inviteKind: text("invite_kind"), // tester | trial | null
  trialEndsAt: integer("trial_ends_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The REAL session table (never login_sessions — that table holds staged
// Security Pack rows and must never be trusted as live auth state, §4.2).
export const authSessions = sqliteTable("auth_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  // SHA-256 hex of the opaque 256-bit session token. Token never stored.
  tokenHash: text("token_hash").notNull().unique(),
  deviceLabel: text("device_label").notNull().default(""),
  userAgent: text("user_agent"),
  ipFirstSeen: text("ip_first_seen"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  // Absolute expiry — 30 days (D3), never extended.
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  // signin | claim | invite_accept — how this session was born.
  createdVia: text("created_via").notNull().default("signin"),
  // Set when sign-in is paused at the TOTP gate (D7): the session exists
  // but does NOT authorize actions until the second factor completes.
  // Null = fully authorized.
  pendingTotpAt: integer("pending_totp_at", { mode: "timestamp_ms" }),
});

// Password resets AND the one-time owner claim — one table, discriminated
// by purpose, so hash-only/single-use/short-TTL hygiene lives in one place.
export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  purpose: text("purpose").notNull().default("reset"), // reset | owner_claim
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  supersededAt: integer("superseded_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Account-creation invites (D2: invite-only). Deliberately separate from
// team_invite_codes: redemption here produces an accounts + profile pair;
// a team code grants a seat on an EXISTING account (§4.4).
export const accountInvites = sqliteTable("account_invites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // tester | trial
  // Normalized email the invite is bound to; acceptance must create the
  // account under exactly this address.
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  // Entitlement granted on acceptance: tester → diamond (D4), trial →
  // diamond for 30 days then basic (D5).
  grantPlan: text("grant_plan"),
  invitedByAccountId: integer("invited_by_account_id"),
  note: text("note").notNull().default(""),
  // pending | accepted | revoked | expired (expired also derived from expires_at)
  status: text("status").notNull().default("pending"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  acceptedAccountId: integer("accepted_account_id"),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Append-only auth audit (§4.5/§8.4). Detail NEVER carries a password,
// token, or full invite code — masked forms only.
export const authAuditLog = sqliteTable("auth_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id"),
  actorAccountId: integer("actor_account_id"),
  event: text("event").notNull(),
  detail: text("detail").notNull().default(""),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Mail outbox for auth links (D1): when the Resend transport is
// configured the row records the provider id as SENT; when it is not,
// the row stays QUEUED and the owner delivers the link by hand — a link
// is never recorded as sent without a provider id coming back.
export const authMailQueue = sqliteTable("auth_mail_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id"),
  kind: text("kind").notNull(), // invite | reset
  toEmail: text("to_email").notNull(),
  // The one place a plaintext link token persists server-side: it must,
  // so the owner can hand-deliver a QUEUED link. Rows are deleted when
  // the token is consumed/expired; sent rows keep no token (cleared).
  linkToken: text("link_token"),
  status: text("status").notNull().default("queued"), // queued | sent
  providerId: text("provider_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
});

// Founding Tester activity (D4): one row per account per local day on
// which a session was resolved. Completion = a session on >= 10 of the
// 14 days since invite acceptance — computed from these rows.
export const authActivityDays = sqliteTable("auth_activity_days", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  day: text("day").notNull(), // YYYY-MM-DD (server local)
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Linked social identities (2026-11-10, x's order: "Google now, Apple
// ready, Face ID too"). One row per (provider, subject) — the
// provider's stable subject id is the identity key, NOT the email
// (emails change; subjects don't). The email recorded is the VERIFIED
// provider email at link time, kept so the owner can see which door an
// account uses. Uniqueness of (provider, provider_subject) is enforced
// structurally in migration 0113. Biometric data NEVER appears here or
// anywhere server-side: Face ID lives in the device's secure enclave.
export const accountIdentities = sqliteTable("account_identities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  provider: text("provider").notNull(), // google | apple
  providerSubject: text("provider_subject").notNull(),
  email: text("email").notNull(),
  linkedAt: integer("linked_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// WebAuthn passkeys ("Sign in with Face ID", 2026-11-10). Stores the
// credential PUBLIC key only (COSE encoding, base64url) — a public key
// is not a secret and no biometric sample ever leaves the device. The
// sign counter is the clone-detection signal from the WebAuthn spec.
export const passkeyCredentials = sqliteTable("passkey_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  // base64url credential id issued by the authenticator; unique.
  credentialId: text("credential_id").notNull().unique(),
  // base64url COSE public key bytes from the attestation/authData.
  publicKey: text("public_key").notNull(),
  signCount: integer("sign_count").notNull().default(0),
  deviceLabel: text("device_label").notNull().default(""),
  // JSON array of transports reported at registration (usb/nfc/ble/internal…)
  transports: text("transports"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
});

// Beta join requests (x's order, 2026-11-11: one public join link +
// owner approval instead of one-by-one invite emails). Written ONLY by
// the public /join form — a row grants nothing by itself (D2 stays
// invite-only). The owner approves/denies from the Owner desk;
// approval mints a tester invite through the standard invite path and
// links it here. At most one pending row per email (handler-enforced).
export const betaJoinRequests = sqliteTable("beta_join_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Normalized (trim + NFC + lowercase) applicant email — the dedupe key.
  email: text("email").notNull(),
  role: text("role").notNull(), // driver | fleet_owner | dispatcher | just_testing
  note: text("note").notNull().default(""),
  // pending | approved | denied — decided rows keep their decision
  // metadata so the desk can show a short history.
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  decidedBy: integer("decided_by"), // owner account id
  // Set on approval: the account_invites row the approval minted and
  // the auth_mail_queue row that carries its link (queued or sent).
  inviteId: integer("invite_id"),
  mailQueueId: integer("mail_queue_id"),
});
