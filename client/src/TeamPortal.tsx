// TEAM CONTACT EMAIL (owner, 2026-10-30, migration 0078): the team's
// own mailbox is stonervisionteam@gmail.com — THE team email. The
// portal header, every team notice, seat-invite issuance, and
// consent-session closeouts are addressed from/for the team under
// this address (the server returns it as teamEmail on getTeamAccess
// and stamps it on every team_change_notices row). It is separate
// from the owner's own account email and from ruggsllc7@gmail.com
// (RUGGS LOGISTICS only). Mail transport stays staged — queued honestly while
// no provider is connected; this address does not change transport.
//
// STONEMILES Team Portal — developer / support seats only (migration 0074).
//
// PLATFORM-level: this is not a company tool. SEAT ACCESS (owner's
// lock, migration 0077): the owner is the ONLY seat holder until he
// approves an addition, and a new seat is granted ONLY when the
// invited developer redeems a single-use TEAM INVITE CODE the owner
// generated for their specific email (TEAM-… — a distinct code type;
// referral, beta, and driver codes never grant a seat). Direct grants
// by username are closed. The portal itself renders only while the
// server says this account holds a seat, and every action re-checks
// the seat server-side; a non-seat account sees only the invite
// redemption form, which is the one door in.
//
// THE WALL, rendered plainly: the team sees ACCOUNT SHELLS only —
// display name, account type, tier, company, seats, account status,
// signup date, public wallet address. Pay Book entries and totals, pay
// stubs, documents and photos, load paperwork contents, chats and
// messages, passwords, wallet keys, seed phrases, and payment
// credentials DO NOT EXIST in any team response — the server never
// selects them, so there is nothing here to hide. Approval exists for
// password-reset help and personal-info edits (recorded before the
// change; the team never sees or sets a password), AND for ONE
// exception the owner added: a consent WINDOW can open exactly one
// Pay Book entry, pay stub, or document the user picks, for one named
// seat, for 30 minutes — view-first, edit only under its own separate
// approval. Passwords themselves, seed phrases, and payment
// credentials stay closed with NO consent override, ever.
// There is no "log in as user" / impersonation control, by design.
// Every action the team takes is written to the audit log shown in
// this portal, and every change notifies the affected user in-app
// (MyTeamActivityCard, Driver tab) and by email.
//
// The team also works both load boards (double-booking desk), hosts
// platform giveaways, and sends SM Points / $STONER under the rewards
// go-live gate — see BoardsTab / GiveawaysTab below.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PdfViewer } from "@hatch/space-sdk/pdf";
import { api, type ApiResponse } from "./api";

type Shell = ApiResponse<typeof api, "teamSearchAccounts">["accounts"][number];
type AccountDetail = ApiResponse<typeof api, "teamGetAccount">;
type PortalAccounts = ApiResponse<typeof api, "teamListPortalAccounts">;
type AuditEntry = ApiResponse<typeof api, "teamGetAuditLog">["entries"][number];
type ItemWindow = ApiResponse<typeof api, "teamListItemWindows">["windows"][number];
type ConsentedItem = NonNullable<ApiResponse<typeof api, "teamViewConsentedItem">["item"]>;

const INPUT =
  "w-full rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-base text-[var(--text)] placeholder:text-[var(--dim)]";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1";

const TIERS = [
  { value: "basic", label: "Basic" },
  { value: "gold", label: "Gold Driver" },
  { value: "diamond", label: "Diamond Driver" },
  { value: "owner", label: "Owner / Fleet" },
] as const;

const AUDIT_LABELS: Record<string, string> = {
  grant_seat: "Team seat granted",
  revoke_seat: "Team seat revoked",
  invite_issued: "Team invite issued (owner)",
  invite_redeemed: "Team invite redeemed — seat granted",
  invite_revoked: "Team invite revoked (owner)",
  invite_redeem_failed: "Team invite redemption refused",
  view_account: "Viewed account shell",
  set_tier: "Tier changed",
  set_seats: "Seats changed",
  unlock_account: "Account unlocked",
  set_status: "Account status changed",
  set_beta_access: "Beta / trial access changed",
  resend_invite: "Invite resent",
  portal_account_status: "Portal account status changed",
  board_claim_returned: "Board claim returned",
  board_row_withdrawn: "Duplicate board row withdrawn",
  board_flagged: "Board load flagged",
  board_flag_cleared: "Board flag cleared",
  send_reward: "Reward sent",
  giveaway_created: "Giveaway created",
  giveaway_funded: "Giveaway funded",
  giveaway_drawn: "Giveaway drawn",
  giveaway_distributed: "Giveaway distributed",
  giveaway_cancelled: "Giveaway cancelled",
  consent_requested: "Consent requested",
  consent_approved: "Consent approved by user",
  consent_denied: "Consent denied by user",
  consent_applied: "Approved change applied",
  password_reset_triggered: "Password reset triggered",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "Not on record";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not on record" : d.toLocaleDateString();
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function StatusChip({ status }: { status: string }) {
  const cls =
    status === "active"
      ? "bg-emerald-900/60 text-emerald-200"
      : status === "locked"
        ? "bg-red-900/60 text-red-200"
        : "bg-amber-900/60 text-amber-200";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{status}</span>;
}

function tierLabel(tier: string): string {
  return TIERS.find((t) => t.value === tier)?.label ?? tier;
}

export function TeamPortalSheet({
  onClose,
  setBanner,
}: {
  onClose: () => void;
  setBanner: (s: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const accessQuery = useQuery({ queryKey: ["team-access"], queryFn: () => api.getTeamAccess({}) });
  const [tab, setTab] = useState<"accounts" | "portals" | "boards" | "giveaways" | "seats" | "audit">("accounts");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tierDraft, setTierDraft] = useState("");
  const [trucksDraft, setTrucksDraft] = useState("");
  const [dispatchDraft, setDispatchDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Team invite drafts (seats tab, owner only) + the one-time code
  // reveal after issuance, and the redemption draft for non-seats.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("support");
  const [issuedInvite, setIssuedInvite] = useState<{ code: string; email: string; expiresAt: string } | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  // Reward send drafts (account detail).
  const [sendAsset, setSendAsset] = useState<"points" | "stoner">("points");
  const [sendAmount, setSendAmount] = useState("");
  const [sendNote, setSendNote] = useState("");
  // Consent request drafts (account detail): password help + the exact
  // personal-info changes the user would be approving.
  const [consentNote, setConsentNote] = useState("");
  const [ciDisplayName, setCiDisplayName] = useState("");
  const [ciEmail, setCiEmail] = useState("");
  const [ciHomeCity, setCiHomeCity] = useState("");
  const [ciHomeState, setCiHomeState] = useState("");
  // Consent-window drafts + viewer (account detail): a request names an
  // item in words only; the viewer holds the ONE item an approved
  // window opened.
  const [itemKind, setItemKind] = useState("pay_entry");
  const [itemDesc, setItemDesc] = useState("");
  const [itemNote, setItemNote] = useState("");
  const [viewedWindowId, setViewedWindowId] = useState<number | null>(null);
  const [viewedItem, setViewedItem] = useState<ConsentedItem | null>(null);
  const [editLines, setEditLines] = useState<{ label: string; amount: string }[]>([]);

  const searchQuery = useQuery({
    queryKey: ["team-accounts", submittedQuery],
    queryFn: () => api.teamSearchAccounts({ query: submittedQuery }),
    enabled: accessQuery.data?.isTeam === true,
  });
  const detailQuery = useQuery({
    queryKey: ["team-account", selected],
    queryFn: () => api.teamGetAccount({ username: selected ?? "" }),
    enabled: accessQuery.data?.isTeam === true && !!selected,
  });
  const portalsQuery = useQuery({
    queryKey: ["team-portal-accounts"],
    queryFn: () => api.teamListPortalAccounts({}),
    enabled: accessQuery.data?.isTeam === true && tab === "portals",
  });
  const seatsQuery = useQuery({
    queryKey: ["team-seats"],
    queryFn: () => api.teamListSeats({}),
    enabled: accessQuery.data?.isTeam === true && tab === "seats",
  });
  const invitesQuery = useQuery({
    queryKey: ["team-invites"],
    queryFn: () => api.teamListInvites({}),
    enabled: accessQuery.data?.canManageSeats === true && tab === "seats",
  });
  const auditQuery = useQuery({
    queryKey: ["team-audit"],
    queryFn: () => api.teamGetAuditLog({ limit: 100 }),
    enabled: accessQuery.data?.isTeam === true && tab === "audit",
  });
  const boardsQuery = useQuery({
    queryKey: ["team-boards"],
    queryFn: () => api.teamGetBoards({}),
    enabled: accessQuery.data?.isTeam === true && tab === "boards",
  });
  const giveawaysQuery = useQuery({
    queryKey: ["team-giveaways"],
    queryFn: () => api.teamListGiveaways({}),
    enabled: accessQuery.data?.isTeam === true && tab === "giveaways",
  });
  const consentQuery = useQuery({
    queryKey: ["team-consent", selected],
    queryFn: () => api.teamListConsentRequests({ username: selected ?? "" }),
    enabled: accessQuery.data?.isTeam === true && !!selected,
  });
  const itemWindowsQuery = useQuery({
    queryKey: ["team-item-windows", selected],
    queryFn: () => api.teamListItemWindows({ username: selected ?? "" }),
    enabled: accessQuery.data?.isTeam === true && !!selected,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["team-accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["team-account"] });
    void queryClient.invalidateQueries({ queryKey: ["team-portal-accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["team-seats"] });
    void queryClient.invalidateQueries({ queryKey: ["team-invites"] });
    void queryClient.invalidateQueries({ queryKey: ["team-audit"] });
    void queryClient.invalidateQueries({ queryKey: ["team-boards"] });
    void queryClient.invalidateQueries({ queryKey: ["team-giveaways"] });
    void queryClient.invalidateQueries({ queryKey: ["team-consent"] });
    void queryClient.invalidateQueries({ queryKey: ["team-item-windows"] });
    void queryClient.invalidateQueries({ queryKey: ["my-team-activity"] });
    void queryClient.invalidateQueries({ queryKey: ["team-access"] });
    void queryClient.invalidateQueries({ queryKey: ["profile"] });
    void queryClient.invalidateQueries({ queryKey: ["beta-panel"] });
  };

  const run = async (fn: () => Promise<{ ok: boolean; error: string | null }>, okMsg: string) => {
    setBusy(true);
    try {
      const r = await fn();
      setBanner(r.ok ? okMsg : (r.error ?? "That didn't go through."));
      if (r.ok) refreshAll();
    } catch {
      setBanner("That didn't go through — try again.");
    } finally {
      setBusy(false);
    }
  };

  const detail: AccountDetail | undefined = detailQuery.data;
  const acct = detail?.account ?? null;
  const shipperLink = detail?.shipper ?? null;
  const brokerLink = detail?.broker ?? null;
  const lockReason = detail?.lockReason ?? null;
  const walletAddress = detail?.walletAddress ?? null;
  const canResetPassword = detail?.canResetPassword ?? false;

  const openAccount = (s: Shell) => {
    setSelected(s.username);
    setViewedItem(null);
    setViewedWindowId(null);
    setTierDraft(s.tier);
    setTrucksDraft(s.trucks != null ? String(s.trucks) : "");
    setDispatchDraft(s.dispatchSeats != null ? String(s.dispatchSeats) : "");
  };

  return (
    <div className="fixed inset-0 z-[970] flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-label="Team Portal">
      <div className="animate-sheet flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden bg-[var(--surface)] shadow-2xl sm:rounded-2xl">
        <div className="pt-safe flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <div className="font-condensed text-2xl font-bold leading-none">🛠️ Team Portal</div>
            <div className="mt-1 text-xs text-[var(--dim)]">
              {accessQuery.data?.isTeam
                ? `Signed in as @${accessQuery.data.username} — ${accessQuery.data.role ?? "team"} seat. Account shells only; every action is logged.`
                : "Developer / support seats only."}
            </div>
            <div className="mt-1 text-xs">
              <span className="text-[var(--dim)]">Team email — Stonervision team — brokers, shippers &amp; help: </span>
              <a
                href={`mailto:${accessQuery.data?.teamEmail ?? "stonervisionteam@gmail.com"}`}
                className="font-bold text-[var(--accent)] underline"
                aria-label={`Email the Stonervision team — brokers, shippers and help — at ${accessQuery.data?.teamEmail ?? "stonervisionteam@gmail.com"}`}
              >
                {accessQuery.data?.teamEmail ?? "stonervisionteam@gmail.com"}
              </a>
              <span className="text-[var(--dim)]"> — the Stonervision team's own mailbox, covering brokers, shippers &amp; help. Team notices, invite issuance, and consent closeouts are addressed from this email. Separate from RUGGS LOGISTICS (ruggsllc7@gmail.com stays for RUGGS LOGISTICS only).</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[var(--surface2)] px-3.5 py-2 font-bold" aria-label="Close Team Portal">
            ✕
          </button>
        </div>

        {accessQuery.isLoading ? (
          <p className="px-4 py-6 text-sm text-[var(--dim)]">Checking your team seat…</p>
        ) : !accessQuery.data?.isTeam ? (
          <div className="px-4 py-6">
            <p className="text-sm leading-relaxed">
              This account doesn't hold a team seat, so the Team Portal doesn't open. Team seats are{" "}
              <strong>invite-only</strong>: the app owner is the only seat holder until he approves an addition,
              and the one way in is a single-use <strong>team invite code</strong> the owner generates for one
              specific email address. Nobody can be added by username, and no other code works — referral codes,
              beta codes, and driver codes never grant a team seat, and a team invite code does nothing else.
            </p>
            <div className="mt-4 rounded-xl bg-[var(--surface2)] px-3 py-3">
              <span className={LABEL}>Have a team invite code?</span>
              <p className="text-xs leading-relaxed text-[var(--dim)]">
                Signed in as @{accessQuery.data?.username}
                {accessQuery.data?.email
                  ? <> — email on file: <strong className="text-[var(--text)]">{accessQuery.data.email}</strong>. The code redeems only if the owner issued it for exactly that email.</>
                  : <> — <strong className="text-[var(--text)]">no email is on file for this account</strong>, so a code can't be matched to it yet. Add the email the owner invited (Loads → Document copies settings → driver email), then redeem.</>}
              </p>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setBusy(true);
                  void api
                    .teamRedeemInvite({ code: redeemCode.trim() })
                    .then((r) => {
                      setBanner(
                        r.ok
                          ? `Team invite redeemed — you now hold a ${r.role ?? "support"} team seat. Welcome to the team.`
                          : (r.error ?? "That code didn't redeem."),
                      );
                      if (r.ok) {
                        setRedeemCode("");
                        refreshAll();
                      }
                    })
                    .catch(() => setBanner("That code didn't redeem — try again."))
                    .finally(() => setBusy(false));
                }}
              >
                <input
                  className={INPUT}
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value)}
                  placeholder="TEAM-XXXX-XXXX-XXXX"
                  aria-label="Team invite code to redeem"
                  autoCapitalize="characters"
                  autoCorrect="off"
                />
                <button
                  type="submit"
                  disabled={busy || !redeemCode.trim()}
                  className="btn-neon shrink-0 rounded-lg px-4 font-bold disabled:opacity-50"
                  aria-label="Redeem team invite code"
                >
                  Redeem
                </button>
              </form>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                Single-use, tied to one email, expires 7 days after the owner issues it. Redeeming is recorded in
                the team audit log and the owner is notified in-app and by email. Team contact for invite help —
                Stonervision team — brokers, shippers &amp; help:{" "}
                <a href={`mailto:${accessQuery.data?.teamEmail ?? "stonervisionteam@gmail.com"}`} className="font-bold text-[var(--accent)] underline">
                  {accessQuery.data?.teamEmail ?? "stonervisionteam@gmail.com"}
                </a>{" "}
                — the team's own mailbox, covering brokers, shippers &amp; help.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-1.5 overflow-x-auto px-4 pt-3" role="tablist" aria-label="Team Portal sections">
              {(
                [
                  { key: "accounts", label: "Accounts" },
                  { key: "portals", label: "Portal accounts" },
                  { key: "boards", label: "Load boards" },
                  { key: "giveaways", label: "Giveaways" },
                  { key: "seats", label: "Team seats" },
                  { key: "audit", label: "Audit log" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-bold ${tab === t.key ? "bg-[var(--accent)] text-black" : "bg-[var(--surface2)] text-[var(--text)]"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {tab === "accounts" && (
                <>
                  <p className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-xs leading-relaxed text-[var(--dim)]">
                    <strong className="text-[var(--text)]">The wall:</strong> team view is the account shell
                    only — name, type, tier, company, seats, status, signup date, public wallet address. Pay Book
                    entries, pay stubs, documents and photos, load paperwork, chats, passwords, seed phrases, and
                    payment details are never in a team response — and <strong className="text-[var(--text)]">no
                    user approval can open them, ever</strong>. Approval exists for exactly two kinds of help:
                    password resets and personal-info edits. There is no “log in as user” here — support never
                    impersonates. Every change notifies the account holder in-app and by email.
                  </p>

                  {!selected && (
                    <>
                      <form
                        className="mt-3 flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setSubmittedQuery(query.trim());
                        }}
                      >
                        <input
                          className={INPUT}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search by name, @username, or email"
                          aria-label="Search accounts by name, username, or email"
                        />
                        <button type="submit" className="btn-neon shrink-0 rounded-lg px-4 font-bold" aria-label="Search accounts">
                          Search
                        </button>
                      </form>
                      {searchQuery.isLoading ? (
                        <p className="mt-4 text-sm text-[var(--dim)]">Loading accounts…</p>
                      ) : searchQuery.data && !searchQuery.data.ok ? (
                        <p className="mt-4 text-sm text-[var(--danger)]">{searchQuery.data.error}</p>
                      ) : (
                        <ul className="mt-3 space-y-1.5">
                          {(searchQuery.data?.accounts ?? []).map((s) => (
                            <li key={s.username}>
                              <button
                                type="button"
                                className="btn-press flex w-full items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-left"
                                aria-label={`Open account ${s.displayName} (@${s.username})`}
                                onClick={() => openAccount(s)}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-bold">{s.displayName}</span>
                                  <span className="block truncate text-xs text-[var(--dim)]">
                                    @{s.username} · {s.accountType} · {tierLabel(s.tier)}
                                    {s.companyName ? ` · ${s.companyName}` : ""}
                                  </span>
                                </span>
                                <StatusChip status={s.status} />
                              </button>
                            </li>
                          ))}
                          {(searchQuery.data?.accounts ?? []).length === 0 && (
                            <li className="rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">
                              No accounts match that search yet.
                            </li>
                          )}
                        </ul>
                      )}
                    </>
                  )}

                  {selected && (
                    <div className="mt-1">
                      <button
                        type="button"
                        className="font-bold text-[var(--accent)]"
                        aria-label="Back to account search"
                        onClick={() => setSelected(null)}
                      >
                        ← All accounts
                      </button>
                      {detailQuery.isLoading ? (
                        <p className="mt-3 text-sm text-[var(--dim)]">Loading the account shell…</p>
                      ) : detail && !detail.ok ? (
                        <p className="mt-3 text-sm text-[var(--danger)]">{detail.error}</p>
                      ) : acct ? (
                        <>
                          <div className="mt-2 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate font-condensed text-2xl font-bold">{acct.displayName}</div>
                              <div className="truncate text-sm text-[var(--dim)]">@{acct.username}</div>
                            </div>
                            <StatusChip status={acct.status} />
                          </div>
                          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">Account type</dt>
                              <dd className="font-semibold">{acct.accountType}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">Tier</dt>
                              <dd className="font-semibold">{tierLabel(acct.tier)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">Company</dt>
                              <dd className="font-semibold">{acct.companyName ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">Signed up</dt>
                              <dd className="font-semibold">{fmtDate(acct.signupAt)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">Email on file</dt>
                              <dd className="break-all font-semibold">{acct.email ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">Beta / trial access</dt>
                              <dd className="font-semibold">{acct.betaAccess === null ? "Not set" : acct.betaAccess ? "Granted" : "Revoked"}</dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">Public wallet address</dt>
                              <dd className="break-all font-semibold">{walletAddress ?? "None on record"}</dd>
                            </div>
                          </dl>
                          {lockReason && (
                            <p className="mt-2 rounded-lg bg-red-900/40 px-3 py-2 text-xs">Lock reason on file: {lockReason}</p>
                          )}

                          <div className="mt-4 border-t border-[var(--border)] pt-3">
                            <label className={LABEL} htmlFor="team-tier">Change tier</label>
                            <div className="flex gap-2">
                              <select id="team-tier" className={INPUT} value={tierDraft} onChange={(e) => setTierDraft(e.target.value)} aria-label="New tier for this account">
                                {TIERS.map((t) => (
                                  <option key={t.value} value={t.value}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={busy || tierDraft === acct.tier}
                                className="shrink-0 rounded-lg bg-[var(--accent)] px-4 font-bold text-black disabled:opacity-50"
                                aria-label={`Save tier for @${acct.username}`}
                                onClick={() => void run(() => api.teamSetTier({ username: acct.username, tier: tierDraft }), `Tier for @${acct.username} is now ${tierLabel(tierDraft)}.`)}
                              >
                                Save
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 border-t border-[var(--border)] pt-3">
                            <span className={LABEL}>Fleet seats</span>
                            <div className="flex gap-2">
                              <input
                                className={INPUT}
                                inputMode="numeric"
                                value={trucksDraft}
                                onChange={(e) => setTrucksDraft(e.target.value.replace(/[^0-9]/g, ""))}
                                placeholder="Trucks"
                                aria-label="Truck seats for this account"
                              />
                              <input
                                className={INPUT}
                                inputMode="numeric"
                                value={dispatchDraft}
                                onChange={(e) => setDispatchDraft(e.target.value.replace(/[^0-9]/g, ""))}
                                placeholder="Dispatch"
                                aria-label="Dispatch seats for this account"
                              />
                              <button
                                type="button"
                                disabled={busy || trucksDraft === "" || dispatchDraft === ""}
                                className="shrink-0 rounded-lg bg-[var(--accent)] px-4 font-bold text-black disabled:opacity-50"
                                aria-label={`Save seats for @${acct.username}`}
                                onClick={() =>
                                  void run(
                                    () => api.teamSetSeats({ username: acct.username, trucks: Number(trucksDraft), dispatchSeats: Number(dispatchDraft) }),
                                    `Seats saved for @${acct.username}: ${trucksDraft} trucks / ${dispatchDraft} dispatch.`,
                                  )
                                }
                              >
                                Save
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
                            {acct.status === "locked" && (
                              <button
                                type="button"
                                disabled={busy}
                                className="btn-neon rounded-lg px-4 py-2.5 font-bold disabled:opacity-50"
                                aria-label={`Unlock account @${acct.username}`}
                                onClick={() => void run(() => api.teamUnlockAccount({ username: acct.username }), `@${acct.username} is unlocked — locks and login cut-offs cleared.`)}
                              >
                                🔓 Unlock account
                              </button>
                            )}
                            {acct.status !== "suspended" ? (
                              <button
                                type="button"
                                disabled={busy}
                                className="rounded-lg bg-[var(--surface2)] px-4 py-2.5 font-bold disabled:opacity-50"
                                aria-label={`Suspend account @${acct.username}`}
                                onClick={() => void run(() => api.teamSetAccountStatus({ username: acct.username, status: "suspended" }), `@${acct.username} is suspended.`)}
                              >
                                Suspend account
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                className="rounded-lg bg-[var(--surface2)] px-4 py-2.5 font-bold disabled:opacity-50"
                                aria-label={`Reactivate account @${acct.username}`}
                                onClick={() => void run(() => api.teamSetAccountStatus({ username: acct.username, status: "active" }), `@${acct.username} is active again.`)}
                              >
                                Reactivate account
                              </button>
                            )}
                            {acct.betaAccess === true ? (
                              <button
                                type="button"
                                disabled={busy}
                                className="rounded-lg bg-[var(--surface2)] px-4 py-2.5 font-bold disabled:opacity-50"
                                aria-label={`Revoke beta access for @${acct.username}`}
                                onClick={() => void run(() => api.teamSetBetaAccess({ username: acct.username, granted: false }), `Beta / trial access revoked for @${acct.username}.`)}
                              >
                                Revoke beta / trial
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                className="rounded-lg bg-[var(--surface2)] px-4 py-2.5 font-bold disabled:opacity-50"
                                aria-label={`Grant beta access to @${acct.username}`}
                                onClick={() => void run(() => api.teamSetBetaAccess({ username: acct.username, granted: true }), `Beta / trial access granted to @${acct.username}.`)}
                              >
                                Grant beta / trial
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-lg bg-[var(--surface2)] px-4 py-2.5 font-bold disabled:opacity-50"
                              aria-label={`Resend invite to @${acct.username}`}
                              onClick={() => {
                                setBusy(true);
                                void api
                                  .teamResendInvite({ username: acct.username })
                                  .then((r) => {
                                    setBanner(r.ok ? `Fresh invite for @${acct.username}: ${r.code} — send it to them; it's single-use.` : (r.error ?? "Couldn't resend that invite."));
                                    if (r.ok) refreshAll();
                                  })
                                  .catch(() => setBanner("Couldn't resend that invite — try again."))
                                  .finally(() => setBusy(false));
                              }}
                            >
                              Resend invite
                            </button>
                          </div>

                          {(shipperLink || brokerLink) && (
                            <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-3">
                              <span className={LABEL}>Linked portal accounts</span>
                              {shipperLink && (
                                <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                                  <span className="min-w-0 text-sm">
                                    <span className="block truncate font-bold">Shipper — {shipperLink.name}</span>
                                    <span className="block text-xs text-[var(--dim)]">Status: {shipperLink.status}</span>
                                  </span>
                                  {shipperLink.status === "active" ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      className="shrink-0 font-bold text-[var(--danger)] disabled:opacity-50"
                                      aria-label={`Suspend shipper account ${shipperLink.name}`}
                                      onClick={() => void run(() => api.teamSetPortalAccountStatus({ kind: "shipper", id: shipperLink.id, status: "suspended" }), `Shipper account ${shipperLink.name} suspended.`)}
                                    >
                                      Suspend
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      className="shrink-0 font-bold text-[var(--accent)] disabled:opacity-50"
                                      aria-label={`Approve shipper account ${shipperLink.name}`}
                                      onClick={() => void run(() => api.teamSetPortalAccountStatus({ kind: "shipper", id: shipperLink.id, status: "active" }), `Shipper account ${shipperLink.name} approved (active).`)}
                                    >
                                      Approve
                                    </button>
                                  )}
                                </div>
                              )}
                              {brokerLink && (
                                <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                                  <span className="min-w-0 text-sm">
                                    <span className="block truncate font-bold">Broker — {brokerLink.name}</span>
                                    <span className="block text-xs text-[var(--dim)]">
                                      Status: {brokerLink.status}
                                      {brokerLink.brokerMc ? ` · MC ${brokerLink.brokerMc}` : ""}
                                    </span>
                                  </span>
                                  {brokerLink.status === "active" ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      className="shrink-0 font-bold text-[var(--danger)] disabled:opacity-50"
                                      aria-label={`Suspend broker account ${brokerLink.name}`}
                                      onClick={() => void run(() => api.teamSetPortalAccountStatus({ kind: "broker", id: brokerLink.id, status: "suspended" }), `Broker account ${brokerLink.name} suspended.`)}
                                    >
                                      Suspend
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      className="shrink-0 font-bold text-[var(--accent)] disabled:opacity-50"
                                      aria-label={`Approve broker account ${brokerLink.name}`}
                                      onClick={() => void run(() => api.teamSetPortalAccountStatus({ kind: "broker", id: brokerLink.id, status: "active" }), `Broker account ${brokerLink.name} approved (active).`)}
                                    >
                                      Approve
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="mt-4 border-t border-[var(--border)] pt-3">
                            <span className={LABEL}>Send a reward</span>
                            <p className="text-xs leading-relaxed text-[var(--dim)]">
                              Sends credit the account{walletAddress ? ` — public address on file ${walletAddress}` : ""}.
                              Reward sends honour the go-live gate: while payouts are gated OFF (until the Nov 20
                              launch + the owner's go-live word) the send refuses and nothing moves. Every send is
                              logged with amount, asset, and destination, and the holder is notified.
                            </p>
                            <div className="mt-2 flex gap-2">
                              <select
                                className="w-32 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2 py-2.5"
                                value={sendAsset}
                                onChange={(e) => setSendAsset(e.target.value as "points" | "stoner")}
                                aria-label="Reward asset to send"
                              >
                                <option value="points">SM Points</option>
                                <option value="stoner">$STONER</option>
                              </select>
                              <input
                                className={INPUT}
                                inputMode="decimal"
                                value={sendAmount}
                                onChange={(e) => setSendAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                                placeholder="Amount"
                                aria-label="Reward amount to send"
                              />
                            </div>
                            <div className="mt-2 flex gap-2">
                              <input
                                className={INPUT}
                                value={sendNote}
                                onChange={(e) => setSendNote(e.target.value)}
                                placeholder="Note (optional) — e.g. Goodwill for the outage"
                                aria-label="Reward note"
                              />
                              <button
                                type="button"
                                disabled={busy || !(Number(sendAmount) > 0)}
                                className="btn-neon shrink-0 rounded-lg px-4 font-bold disabled:opacity-50"
                                aria-label={`Send reward to @${acct.username}`}
                                onClick={() =>
                                  void run(
                                    () => api.teamSendReward({ username: acct.username, asset: sendAsset, amount: Number(sendAmount), note: sendNote.trim() || undefined }),
                                    `Sent ${sendAmount} ${sendAsset === "points" ? "SM Points" : "$STONER"} to @${acct.username}.`,
                                  ).then(() => {
                                    setSendAmount("");
                                    setSendNote("");
                                  })
                                }
                              >
                                Send
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 border-t border-[var(--border)] pt-3">
                            <span className={LABEL}>Password &amp; personal info — approval required</span>
                            <p className="text-xs leading-relaxed text-[var(--dim)]">
                              The ONLY help that runs on user approval. Nothing changes until @{acct.username}{" "}
                              approves in their app — <strong className="text-[var(--text)]">no approval, no change,
                              no help</strong>. Approval never opens Pay Book, stubs, documents, messages, seeds, or
                              payment details. Even approved, you never see or set their password: an approved
                              reset clears the PIN and signs out sessions, and they set their own new PIN.
                              {!canResetPassword && " (Password resets apply to this device's account; other accounts reset from their own app.)"}
                            </p>
                            <input
                              className={`${INPUT} mt-2`}
                              value={consentNote}
                              onChange={(e) => setConsentNote(e.target.value)}
                              placeholder="Why — shown to the user with the request"
                              aria-label="Reason shown to the user with the approval request"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              className="mt-2 w-full rounded-lg bg-[var(--surface2)] px-4 py-2.5 font-bold disabled:opacity-50"
                              aria-label={`Request approval for password reset help for @${acct.username}`}
                              onClick={() =>
                                void run(
                                  () => api.teamRequestConsent({ username: acct.username, kind: "password_reset", note: consentNote.trim() }),
                                  `Approval requested — @${acct.username} decides in their app. Nothing changes unless they approve.`,
                                )
                              }
                            >
                              Request approval — password / PIN reset help
                            </button>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <input className={INPUT} value={ciDisplayName} onChange={(e) => setCiDisplayName(e.target.value)} placeholder="Display name" aria-label="Proposed display name" />
                              <input className={INPUT} value={ciEmail} onChange={(e) => setCiEmail(e.target.value)} placeholder="Email on file" aria-label="Proposed email on file" />
                              <input className={INPUT} value={ciHomeCity} onChange={(e) => setCiHomeCity(e.target.value)} placeholder="Home city" aria-label="Proposed home city" />
                              <input className={INPUT} value={ciHomeState} onChange={(e) => setCiHomeState(e.target.value)} placeholder="Home state" aria-label="Proposed home state" />
                            </div>
                            <button
                              type="button"
                              disabled={busy || (!ciDisplayName.trim() && !ciEmail.trim() && !ciHomeCity.trim() && !ciHomeState.trim())}
                              className="mt-2 w-full rounded-lg bg-[var(--surface2)] px-4 py-2.5 font-bold disabled:opacity-50"
                              aria-label={`Request approval for personal info changes for @${acct.username}`}
                              onClick={() =>
                                void run(
                                  () =>
                                    api.teamRequestConsent({
                                      username: acct.username,
                                      kind: "personal_info",
                                      note: consentNote.trim(),
                                      fields: {
                                        displayName: ciDisplayName.trim() || undefined,
                                        email: ciEmail.trim() || undefined,
                                        homeCity: ciHomeCity.trim() || undefined,
                                        homeState: ciHomeState.trim() || undefined,
                                      },
                                    }),
                                  `Approval requested — @${acct.username} decides in their app. Nothing changes unless they approve.`,
                                ).then(() => {
                                  setCiDisplayName("");
                                  setCiEmail("");
                                  setCiHomeCity("");
                                  setCiHomeState("");
                                })
                              }
                            >
                              Request approval — personal-info changes
                            </button>
                            {(consentQuery.data?.requests ?? []).length > 0 && (
                              <ul className="mt-3 space-y-1.5">
                                {(consentQuery.data?.requests ?? []).map((r) => (
                                  <li key={r.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
                                    <span className="font-bold">{r.kind === "password_reset" ? "Password / PIN reset help" : "Personal-info changes"}</span>
                                    <span className="text-[var(--dim)]">
                                      {" "}
                                      — {r.status} · asked by @{r.requestedBy} · {fmtWhen(r.createdAt)}
                                    </span>
                                    <span className="block text-xs leading-relaxed text-[var(--dim)]">{r.detail}</span>
                                    {r.status === "approved" && (
                                      <button
                                        type="button"
                                        disabled={busy}
                                        className="btn-neon mt-2 rounded-lg px-3.5 py-1.5 text-sm font-bold disabled:opacity-50"
                                        aria-label={`Apply approved request ${r.id} for @${acct.username}`}
                                        onClick={() =>
                                          void run(
                                            () => api.teamApplyConsent({ requestId: r.id }),
                                            r.kind === "password_reset"
                                              ? `Reset triggered for @${acct.username} — they set their own new PIN.`
                                              : `Approved changes applied for @${acct.username}.`,
                                          )
                                        }
                                      >
                                        Apply approved change
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="mt-4 border-t border-[var(--border)] pt-3">
                            <span className={LABEL}>Sensitive-item help — consent window</span>
                            <p className="text-xs leading-relaxed text-[var(--dim)]">
                              The wall stands by default. To look at ONE Pay Book entry, pay stub, or document,
                              send a request naming it in words — <strong className="text-[var(--text)]">the request
                              opens nothing</strong>. @{acct.username} approves in their own app, picks the exact
                              item themselves, and chooses view-only or view + edit (editing is its own separate
                              approval — a view grant never implies it). The window runs 30 minutes for your seat
                              only, they can revoke it instantly, and everything you open or change lands in their
                              session record (in-app + email) and the audit log. Passwords, seed phrases, and
                              payment credentials can never be opened — no consent exists for them.
                            </p>
                            <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Item kind for the consent request">
                              {(
                                [
                                  { value: "pay_entry", label: "Pay Book entry" },
                                  { value: "pay_stub", label: "Pay stub" },
                                  { value: "document", label: "Document" },
                                ] as const
                              ).map((k) => (
                                <button
                                  key={k.value}
                                  type="button"
                                  aria-pressed={itemKind === k.value}
                                  className={`rounded-lg px-2 py-2 text-sm font-bold ${itemKind === k.value ? "btn-neon" : "bg-[var(--surface2)]"}`}
                                  onClick={() => setItemKind(k.value)}
                                >
                                  {k.label}
                                </button>
                              ))}
                            </div>
                            <input
                              className={`${INPUT} mt-2`}
                              value={itemDesc}
                              onChange={(e) => setItemDesc(e.target.value)}
                              placeholder="Which item, in words — e.g. the RUGGS LOGISTICS settlement for the week of Oct 12"
                              aria-label="Which item, described in words for the user"
                            />
                            <input
                              className={`${INPUT} mt-2`}
                              value={itemNote}
                              onChange={(e) => setItemNote(e.target.value)}
                              placeholder="Why you need it — shown to the user"
                              aria-label="Why you need access, shown to the user"
                            />
                            <button
                              type="button"
                              disabled={busy || itemDesc.trim().length < 3}
                              className="mt-2 w-full rounded-lg bg-[var(--surface2)] px-4 py-2.5 font-bold disabled:opacity-50"
                              aria-label={`Request a consent window for @${acct.username}`}
                              onClick={() =>
                                void run(
                                  () =>
                                    api.teamRequestItemConsent({
                                      username: acct.username,
                                      itemKind,
                                      description: itemDesc.trim(),
                                      note: itemNote.trim() || undefined,
                                    }),
                                  `Request sent — @${acct.username} decides in their app. Nothing is open unless they approve and pick the item.`,
                                ).then(() => {
                                  setItemDesc("");
                                  setItemNote("");
                                })
                              }
                            >
                              Request access to one item
                            </button>
                            {(itemWindowsQuery.data?.windows ?? []).length > 0 && (
                              <ul className="mt-3 space-y-1.5">
                                {(itemWindowsQuery.data?.windows ?? []).map((w: ItemWindow) => (
                                  <li key={w.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
                                    <span className="font-bold">
                                      {w.itemKind === "pay_entry" ? "Pay Book entry" : w.itemKind === "pay_stub" ? "Pay stub" : "Document"}
                                    </span>
                                    <span className="text-[var(--dim)]">
                                      {" "}
                                      — {w.status}
                                      {w.status === "active" && w.expiresAt ? ` · closes ${fmtWhen(w.expiresAt)}` : ""} · seat @{w.teamSeat}
                                      {w.canEdit ? " · view + edit" : " · view only"}
                                    </span>
                                    <span className="block text-xs leading-relaxed text-[var(--dim)]">
                                      {w.itemLabel ?? `“${w.description}”`}
                                    </span>
                                    {w.status === "active" && (
                                      <button
                                        type="button"
                                        disabled={busy}
                                        className="btn-neon mt-2 rounded-lg px-3.5 py-1.5 text-sm font-bold disabled:opacity-50"
                                        aria-label={`View the item in consent window ${w.id}`}
                                        onClick={() => {
                                          setBusy(true);
                                          void api
                                            .teamViewConsentedItem({ windowId: w.id })
                                            .then((r) => {
                                              if (r.ok && r.item) {
                                                setViewedWindowId(w.id);
                                                setViewedItem(r.item);
                                                setEditLines(r.item.deductionLines.map((l) => ({ label: l.label, amount: String(l.amount) })));
                                                setBanner(`Viewing the one item @${acct.username} approved — this view is in their session record.`);
                                              } else {
                                                setBanner(r.error ?? "That window isn't open.");
                                              }
                                              refreshAll();
                                            })
                                            .catch(() => setBanner("That didn't go through — try again."))
                                            .finally(() => setBusy(false));
                                        }}
                                      >
                                        View item
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {viewedItem && viewedWindowId != null && (
                              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-sm font-bold">{viewedItem.label}</span>
                                  <button
                                    type="button"
                                    className="shrink-0 text-sm font-bold text-[var(--accent)]"
                                    aria-label="Close the viewed item"
                                    onClick={() => {
                                      setViewedItem(null);
                                      setViewedWindowId(null);
                                    }}
                                  >
                                    Close
                                  </button>
                                </div>
                                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                                  {viewedItem.fields.map((f) => (
                                    <div key={f.name}>
                                      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">{f.name}</dt>
                                      <dd className="font-semibold">{f.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                                {viewedItem.deductionLines.length > 0 && (
                                  <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                                    Deductions: {viewedItem.deductionLines.map((l) => `${l.label} $${l.amount.toFixed(2)}`).join(" · ")}
                                  </p>
                                )}
                                {viewedItem.fileUrl && viewedItem.fileMime === "application/pdf" && (
                                  <div className="mt-2">
                                    <PdfViewer src={viewedItem.fileUrl} ariaLabel={`Consented item file: ${viewedItem.label}`} />
                                  </div>
                                )}
                                {viewedItem.fileUrl && viewedItem.fileMime !== "application/pdf" && viewedItem.fileMime?.startsWith("image/") && (
                                  <img src={viewedItem.fileUrl} alt={`The file for ${viewedItem.label}, opened inside the user's consent window`} className="mt-2 w-full rounded-lg" />
                                )}
                                {viewedItem.fileUrl && viewedItem.fileMime !== "application/pdf" && !viewedItem.fileMime?.startsWith("image/") && (
                                  <a href={viewedItem.fileUrl} target="_blank" rel="noreferrer" className="mt-2 block text-sm font-bold text-[var(--accent)]">
                                    Open the item's file
                                  </a>
                                )}
                                {viewedItem.kind === "pay_entry" && viewedItem.canEdit && (
                                  <div className="mt-3 border-t border-[var(--border)] pt-2.5">
                                    <span className={LABEL}>Edit deduction lines (approved edit window)</span>
                                    {editLines.map((l, i) => (
                                      <div key={i} className="mt-1.5 flex gap-2">
                                        <input
                                          className={INPUT}
                                          value={l.label}
                                          onChange={(e) => setEditLines(editLines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                                          placeholder="Label — e.g. Fuel"
                                          aria-label={`Deduction line ${i + 1} label`}
                                        />
                                        <input
                                          className={`${INPUT} w-28 shrink-0`}
                                          value={l.amount}
                                          inputMode="decimal"
                                          onChange={(e) => setEditLines(editLines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                                          placeholder="0.00"
                                          aria-label={`Deduction line ${i + 1} amount`}
                                        />
                                        <button
                                          type="button"
                                          className="shrink-0 rounded-lg bg-[var(--surface2)] px-2.5 font-bold"
                                          aria-label={`Remove deduction line ${i + 1}`}
                                          onClick={() => setEditLines(editLines.filter((_, j) => j !== i))}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    ))}
                                    <div className="mt-2 flex gap-2">
                                      <button
                                        type="button"
                                        className="rounded-lg bg-[var(--surface2)] px-3 py-2 text-sm font-bold"
                                        aria-label="Add a deduction line"
                                        onClick={() => setEditLines([...editLines, { label: "", amount: "" }])}
                                      >
                                        + Add line
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        className="btn-neon rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
                                        aria-label="Save the edited deduction lines"
                                        onClick={() => {
                                          setBusy(true);
                                          void api
                                            .teamEditConsentedPayEntry({
                                              windowId: viewedWindowId,
                                              deductionLines: editLines
                                                .filter((l) => l.label.trim())
                                                .map((l) => ({ label: l.label.trim(), amount: Number(l.amount) || 0 })),
                                            })
                                            .then((r) => {
                                              setBanner(r.ok ? "Deduction lines saved — the edit is in the user's session record and they were notified." : (r.error ?? "That didn't go through."));
                                              if (r.ok) {
                                                void api.teamViewConsentedItem({ windowId: viewedWindowId }).then((v) => {
                                                  if (v.ok && v.item) setViewedItem(v.item);
                                                });
                                                refreshAll();
                                              }
                                            })
                                            .catch(() => setBanner("That didn't go through — try again."))
                                            .finally(() => setBusy(false));
                                        }}
                                      >
                                        Save deduction lines
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </>
              )}

              {tab === "portals" && (
                <PortalAccountsList
                  data={portalsQuery.data}
                  loading={portalsQuery.isLoading}
                  busy={busy}
                  onSetStatus={(kind, id, status, name) =>
                    void run(
                      () => api.teamSetPortalAccountStatus({ kind, id, status }),
                      `${kind === "shipper" ? "Shipper" : "Broker"} account ${name} ${status === "active" ? "approved (active)" : "suspended"}.`,
                    )
                  }
                />
              )}

              {tab === "boards" && (
                <BoardsTab
                  data={boardsQuery.data}
                  loading={boardsQuery.isLoading}
                  busy={busy}
                  onRun={run}
                />
              )}

              {tab === "giveaways" && (
                <GiveawaysTab
                  data={giveawaysQuery.data}
                  loading={giveawaysQuery.isLoading}
                  busy={busy}
                  onRun={run}
                />
              )}

              {tab === "seats" && (
                <div>
                  <div className="rounded-xl bg-[var(--surface2)] px-3 py-3" aria-label="Team mailbox — Stonervision team, brokers, shippers and help">
                    <span className={LABEL}>Team mailbox — Stonervision team — brokers, shippers &amp; help</span>
                    <p className="text-sm">
                      <a href={`mailto:${accessQuery.data?.teamEmail ?? "stonervisionteam@gmail.com"}`} className="font-bold text-[var(--accent)] underline" aria-label={`Email the team at ${accessQuery.data?.teamEmail ?? "stonervisionteam@gmail.com"}`}>
                        {accessQuery.data?.teamEmail ?? "stonervisionteam@gmail.com"}
                      </a>{" "}
                      <span className="text-[var(--dim)]">({accessQuery.data?.teamEmailName ?? "Stonervision Team"})</span>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                      This is THE team email: team notices, seat-invite issuance, and consent-session closeouts are
                      addressed from/for the team under this address wherever the app records a team email, and
                      every team-change notice is stamped with it. The owner's own account keeps its own email —
                      this mailbox is the team's, separate from ruggsllc7@gmail.com, which stays for RUGGS LOGISTICS only.
                      Email transport stays staged: notices queue honestly while no mail provider is connected;
                      recording this address doesn't change how mail sends.
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
                    <strong className="text-[var(--text)]">Owner's lock:</strong> the app owner is the only team
                    seat holder until he approves an addition. New seats are granted <strong className="text-[var(--text)]">only</strong> by
                    redeeming an owner-issued team invite code — direct grants by username are closed, and no
                    referral, beta, or driver code can ever grant a seat. A seat opens this portal and nothing
                    else: no company rights, no user data beyond account shells. Issuing, redeeming, and revoking
                    all land in the audit log, and issuance and redemption notify the owner in-app and by email
                    under the team mailbox above.
                  </p>

                  {accessQuery.data?.canManageSeats ? (
                    <div className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-3">
                      <span className={LABEL}>Add a team member — owner only</span>
                      <p className="text-xs leading-relaxed text-[var(--dim)]">
                        Generate a single-use team invite code tied to the developer's email address. Generating
                        it <em>is</em> your approval — nothing is added until they redeem it from the account whose
                        email on file matches that address. The code (TEAM-…) is a separate code type from
                        referral (MILE-REF-…), beta, and driver (MILE-…) codes, and it does nothing else.
                      </p>
                      <form
                        className="mt-2 flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setBusy(true);
                          void api
                            .teamCreateInvite({ email: inviteEmail.trim(), role: inviteRole })
                            .then((r) => {
                              if (r.ok && r.code && r.expiresAt) {
                                setIssuedInvite({ code: r.code, email: inviteEmail.trim().toLowerCase(), expiresAt: r.expiresAt });
                                setInviteEmail("");
                                setBanner(`Team invite issued for ${inviteEmail.trim().toLowerCase()} — send the code to that developer yourself; it shows here once.`);
                                refreshAll();
                              } else {
                                setBanner(r.error ?? "Couldn't issue that invite.");
                              }
                            })
                            .catch(() => setBanner("Couldn't issue that invite — try again."))
                            .finally(() => setBusy(false));
                        }}
                      >
                        <input
                          className={INPUT}
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="Developer email — e.g. dev@example.com"
                          aria-label="Email address to tie the team invite to"
                          inputMode="email"
                          autoCapitalize="none"
                          autoCorrect="off"
                        />
                        <select className="w-32 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2.5" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} aria-label="Team seat role for the invite">
                          <option value="support">Support</option>
                          <option value="developer">Developer</option>
                        </select>
                        <button type="submit" disabled={busy || !inviteEmail.trim()} className="btn-neon shrink-0 rounded-lg px-4 font-bold disabled:opacity-50" aria-label="Generate team invite code">
                          Generate
                        </button>
                      </form>
                      {issuedInvite && (
                        <div className="mt-3 rounded-lg border border-[var(--glass-border)] bg-[var(--surface)] px-3 py-3">
                          <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
                            Team invite for {issuedInvite.email} — shown once
                          </div>
                          <div className="mt-1 break-all font-condensed text-2xl font-bold tracking-wider" aria-label="The new team invite code">
                            {issuedInvite.code}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                            Send this code to {issuedInvite.email} yourself — from the team mailbox{" "}
                            {accessQuery.data?.teamEmail ?? "stonervisionteam@gmail.com"} (email it to that address
                            from there so it reads as the team's own). They redeem it from the STONEMILES account
                            whose email on file is that address — App Menu → Team Portal → Redeem. Single-use;
                            expires {fmtDate(issuedInvite.expiresAt)}. It won't be shown in full again — if it's
                            lost, revoke the invite below and generate a fresh one.
                          </p>
                          <button
                            type="button"
                            className="mt-2 text-sm font-bold text-[var(--accent)]"
                            aria-label="Dismiss the issued invite code"
                            onClick={() => setIssuedInvite(null)}
                          >
                            Done — hide the code
                          </button>
                        </div>
                      )}
                      {(invitesQuery.data?.invites ?? []).length > 0 && (
                        <>
                          <div className="mt-3 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Team invites</div>
                          <ul className="mt-1.5 space-y-1.5">
                            {(invitesQuery.data?.invites ?? []).map((inv) => (
                              <li key={inv.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
                                <span className="min-w-0">
                                  <span className="block truncate font-bold">{inv.email}</span>
                                  <span className="block text-xs text-[var(--dim)]">
                                    {inv.codeMasked} · {inv.role} · {inv.status}
                                    {inv.status === "pending" ? ` · expires ${fmtDate(inv.expiresAt)}` : ""}
                                    {inv.redeemedBy ? ` · redeemed by @${inv.redeemedBy}` : ""}
                                  </span>
                                </span>
                                {inv.status === "pending" && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className="shrink-0 font-bold text-[var(--danger)] disabled:opacity-50"
                                    aria-label={`Revoke team invite for ${inv.email}`}
                                    onClick={() => void run(() => api.teamRevokeInvite({ inviteId: inv.id }), `Team invite for ${inv.email} revoked — that code can no longer grant a seat.`)}
                                  >
                                    Revoke
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-xs leading-relaxed text-[var(--dim)]">
                      Only the app owner can add team members (by invite code) or revoke a seat. If the team needs
                      another seat, the owner issues the invite from his own account.
                    </p>
                  )}

                  <div className="mt-3 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Team seats</div>
                  <ul className="mt-1.5 space-y-1.5">
                    {(seatsQuery.data?.seats ?? []).map((s) => (
                      <li key={s.username} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                        <span className="min-w-0 text-sm">
                          <span className="block truncate font-bold">@{s.username}</span>
                          <span className="block text-xs text-[var(--dim)]">
                            {s.role} · {s.active ? "active" : "revoked"} · granted by @{s.grantedBy} on {fmtDate(s.createdAt)}
                          </span>
                        </span>
                        {s.active && accessQuery.data?.canManageSeats && s.username !== accessQuery.data?.username && (
                          <button
                            type="button"
                            disabled={busy}
                            className="shrink-0 font-bold text-[var(--danger)] disabled:opacity-50"
                            aria-label={`Revoke team seat for @${s.username}`}
                            onClick={() => void run(() => api.teamRevokeSeat({ username: s.username }), `Team seat revoked for @${s.username} — access ended instantly.`)}
                          >
                            Revoke
                          </button>
                        )}
                      </li>
                    ))}
                    {(seatsQuery.data?.seats ?? []).length === 0 && (
                      <li className="rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">No team seats yet.</li>
                    )}
                  </ul>
                </div>
              )}

              {tab === "audit" && (
                <div>
                  <p className="text-sm leading-relaxed text-[var(--dim)]">
                    Every team action lands here — who acted, which account, what changed, when. Entries are
                    never edited or deleted, and each one is also sealed into the app's hash chain.
                  </p>
                  {auditQuery.isLoading ? (
                    <p className="mt-3 text-sm text-[var(--dim)]">Loading the audit log…</p>
                  ) : (
                    <ul className="mt-3 space-y-1.5">
                      {(auditQuery.data?.entries ?? []).map((e: AuditEntry) => (
                        <li key={e.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
                          <span className="font-bold">{AUDIT_LABELS[e.action] ?? e.action}</span>
                          <span className="text-[var(--dim)]">
                            {" "}
                            — by @{e.actor}
                            {e.targetUsername ? ` · @${e.targetUsername}` : ""} · {fmtWhen(e.createdAt)}
                          </span>
                          {e.detail && <span className="block text-xs leading-relaxed text-[var(--dim)]">{e.detail}</span>}
                        </li>
                      ))}
                      {(auditQuery.data?.entries ?? []).length === 0 && (
                        <li className="rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">No team actions recorded yet.</li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PortalAccountsList({
  data,
  loading,
  busy,
  onSetStatus,
}: {
  data: PortalAccounts | undefined;
  loading: boolean;
  busy: boolean;
  onSetStatus: (kind: "shipper" | "broker", id: number, status: "active" | "suspended", name: string) => void;
}) {
  if (loading) return <p className="text-sm text-[var(--dim)]">Loading portal accounts…</p>;
  if (!data) return null;
  if (!data.ok) return <p className="text-sm text-[var(--danger)]">{data.error}</p>;
  const rows: Array<{
    kind: "shipper" | "broker";
    id: number;
    name: string;
    email: string;
    contactName: string | null;
    extra: string | null;
    linkedUsername: string | null;
    status: string;
    createdAt: string;
  }> = [
    ...data.shippers.map((s) => ({ kind: "shipper" as const, ...s, extra: null })),
    ...data.brokers.map((b) => ({ kind: "broker" as const, ...b, extra: b.brokerMc ? `MC ${b.brokerMc}` : null })),
  ];
  return (
    <div>
      <p className="text-sm leading-relaxed text-[var(--dim)]">
        Shipper and broker portal accounts the desk invited. Approving sets an account active; suspending stops
        its portal access without touching the boards or its loads.
      </p>
      <ul className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
            <span className="min-w-0 text-sm">
              <span className="block truncate font-bold">
                {r.kind === "shipper" ? "🚚" : "🏢"} {r.name}
              </span>
              <span className="block truncate text-xs text-[var(--dim)]">
                {r.email}
                {r.contactName ? ` · ${r.contactName}` : ""}
                {r.extra ? ` · ${r.extra}` : ""}
                {r.linkedUsername ? ` · @${r.linkedUsername}` : ""}
              </span>
              <span className="block text-xs text-[var(--dim)]">Since {fmtDate(r.createdAt)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <StatusChip status={r.status} />
              {r.status === "active" ? (
                <button
                  type="button"
                  disabled={busy}
                  className="font-bold text-[var(--danger)] disabled:opacity-50"
                  aria-label={`Suspend ${r.kind} account ${r.name}`}
                  onClick={() => onSetStatus(r.kind, r.id, "suspended", r.name)}
                >
                  Suspend
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  className="font-bold text-[var(--accent)] disabled:opacity-50"
                  aria-label={`Approve ${r.kind} account ${r.name}`}
                  onClick={() => onSetStatus(r.kind, r.id, "active", r.name)}
                >
                  Approve
                </button>
              )}
            </span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">
            No shipper or broker portal accounts exist yet — the desk invites them from the Shipper / Broker Portals.
          </li>
        )}
      </ul>
    </div>
  );
}

type BoardsData = ApiResponse<typeof api, "teamGetBoards">;
type BoardRow = BoardsData["rows"][number];
type RunFn = (fn: () => Promise<{ ok: boolean; error: string | null }>, okMsg: string) => Promise<void>;

function BoardsTab({ data, loading, busy, onRun }: { data: BoardsData | undefined; loading: boolean; busy: boolean; onRun: RunFn }) {
  const [flagOpenId, setFlagOpenId] = useState<number | null>(null);
  const [flagNote, setFlagNote] = useState("");
  if (loading) return <p className="text-sm text-[var(--dim)]">Loading both boards…</p>;
  if (!data) return null;
  if (!data.ok) return <p className="text-sm text-[var(--danger)]">{data.error}</p>;
  const rows = [...data.rows].sort((a, b) => (b.conflict ? 1 : 0) - (a.conflict ? 1 : 0));
  return (
    <div>
      <p className="text-sm leading-relaxed text-[var(--dim)]">
        Both boards — the Open Board and every private Fleet Board — on one desk, so a double booking can't
        hide between them. A load live in two places, or claimed twice, is flagged below: return the duplicate
        claim, withdraw the duplicate row, or flag it for the desk. The load's paperwork itself never opens
        here. Every resolution is logged and the affected driver and poster are notified.
      </p>
      {data.conflictCount > 0 ? (
        <p className="mt-3 rounded-xl bg-red-900/40 px-3 py-2.5 text-sm font-bold">
          ⚠️ {data.conflictCount} board row{data.conflictCount === 1 ? "" : "s"} in a double-booking conflict — resolve them below.
        </p>
      ) : (
        <p className="mt-3 rounded-xl bg-emerald-900/40 px-3 py-2.5 text-sm">No double bookings right now — every load is live in exactly one place.</p>
      )}
      <ul className="mt-3 space-y-1.5">
        {rows.map((r: BoardRow) => (
          <li key={r.id} className={`rounded-xl px-3 py-2.5 ${r.conflict ? "bg-red-900/30" : "bg-[var(--surface2)]"}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 text-sm">
                <span className="block truncate font-bold">
                  #{r.id} · {r.pickupCity ?? "?"} {r.pickupState ?? ""} → {r.deliveryCity ?? "?"} {r.deliveryState ?? ""}
                </span>
                <span className="block truncate text-xs text-[var(--dim)]">
                  {r.boardScope === "open" ? "Open Board" : `Fleet Board${r.companyName ? ` — ${r.companyName}` : ""}`}
                  {r.originLabel ? ` · origin: ${r.originLabel}` : ""}
                  {r.shipper ? ` · ${r.shipper}` : ""} · posted by @{r.postedBy}
                </span>
                <span className="block text-xs text-[var(--dim)]">
                  {r.status === "taken" ? `Claimed by @${r.claimedBy ?? "?"}${r.claimedAt ? ` · ${fmtWhen(r.claimedAt)}` : ""}` : `Status: ${r.status}`}
                </span>
                {r.conflict && <span className="block text-xs font-bold text-red-200">{r.conflict}</span>}
                {r.flagNote !== null && <span className="block text-xs text-amber-200">🚩 Flagged{r.flagNote ? `: ${r.flagNote}` : ""}</span>}
                {r.status === "taken" && !r.canReturnClaim && r.returnBlockedReason && (
                  <span className="block text-xs text-[var(--dim)]">Claim return blocked: {r.returnBlockedReason}</span>
                )}
              </span>
              <StatusChip status={r.status === "taken" ? "locked" : r.status === "open" ? "active" : "suspended"} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {r.status === "taken" && r.canReturnClaim && (
                <button
                  type="button"
                  disabled={busy}
                  className="btn-neon rounded-lg px-3.5 py-1.5 text-sm font-bold disabled:opacity-50"
                  aria-label={`Return claim on board load ${r.id}`}
                  onClick={() => void onRun(() => api.teamReturnBoardClaim({ boardLoadId: r.id }), `Claim on load #${r.id} returned to the board — @${r.claimedBy ?? "the driver"} was notified.`)}
                >
                  Return claim
                </button>
              )}
              {r.status === "open" && (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg bg-[var(--surface)] px-3.5 py-1.5 text-sm font-bold disabled:opacity-50"
                  aria-label={`Withdraw board row ${r.id}`}
                  onClick={() => void onRun(() => api.teamWithdrawBoardRow({ boardLoadId: r.id }), `Board row #${r.id} withdrawn.`)}
                >
                  Withdraw row
                </button>
              )}
              {r.flagNote === null ? (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg bg-[var(--surface)] px-3.5 py-1.5 text-sm font-bold disabled:opacity-50"
                  aria-label={`Flag board load ${r.id}`}
                  onClick={() => {
                    setFlagOpenId(flagOpenId === r.id ? null : r.id);
                    setFlagNote("");
                  }}
                >
                  Flag
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg bg-[var(--surface)] px-3.5 py-1.5 text-sm font-bold disabled:opacity-50"
                  aria-label={`Clear flag on board load ${r.id}`}
                  onClick={() => void onRun(() => api.teamClearBoardFlag({ boardLoadId: r.id }), `Flag cleared on load #${r.id}.`)}
                >
                  Clear flag
                </button>
              )}
            </div>
            {flagOpenId === r.id && r.flagNote === null && (
              <div className="mt-2 flex gap-2">
                <input
                  className={INPUT}
                  value={flagNote}
                  onChange={(e) => setFlagNote(e.target.value)}
                  placeholder="Why is this flagged? (e.g. same load on both boards)"
                  aria-label={`Flag note for board load ${r.id}`}
                />
                <button
                  type="button"
                  disabled={busy}
                  className="shrink-0 rounded-lg bg-[var(--accent)] px-3.5 font-bold text-black disabled:opacity-50"
                  aria-label={`Save flag on board load ${r.id}`}
                  onClick={() =>
                    void onRun(() => api.teamFlagBoardLoad({ boardLoadId: r.id, note: flagNote }), `Load #${r.id} flagged.`).then(() => setFlagOpenId(null))
                  }
                >
                  Save flag
                </button>
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">No board loads on either board yet.</li>
        )}
      </ul>
    </div>
  );
}

type GiveawaysData = ApiResponse<typeof api, "teamListGiveaways">;
type TeamGiveaway = GiveawaysData["giveaways"][number];

function GiveawaysTab({ data, loading, busy, onRun }: { data: GiveawaysData | undefined; loading: boolean; busy: boolean; onRun: RunFn }) {
  const [currency, setCurrency] = useState<"STONER" | "USD">("STONER");
  const [pot, setPot] = useState("");
  const [mode, setMode] = useState<"selected" | "random">("selected");
  const [winnerCount, setWinnerCount] = useState("1");
  const [split, setSplit] = useState<"equal" | "per_driver">("equal");
  const [note, setNote] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  if (loading) return <p className="text-sm text-[var(--dim)]">Loading giveaways…</p>;
  if (!data) return null;
  if (!data.ok) return <p className="text-sm text-[var(--danger)]">{data.error}</p>;

  const create = () => {
    const recipients = recipientsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [username = "", payoutAddress = "", amount = ""] = line.split(",").map((s) => s.trim());
        return { username: username.replace(/^@/, ""), payoutAddress, amount: amount ? Number(amount) : null };
      });
    if (recipients.length === 0 || recipients.some((r) => !r.username || !r.payoutAddress)) {
      return;
    }
    void onRun(
      () =>
        api.teamCreateGiveaway({
          currency,
          potAmount: Number(pot),
          mode,
          winnerCount: mode === "random" ? Number(winnerCount) : null,
          split,
          distributionNote: note.trim() || null,
          recipients,
        }).then((r) => ({ ok: r.ok, error: r.error })),
      `Giveaway created as a draft — fund it when you're ready.`,
    ).then(() => {
      setPot("");
      setRecipientsText("");
      setNote("");
    });
  };

  return (
    <div>
      <p className="text-sm leading-relaxed text-[var(--dim)]">
        Platform campaigns on the giveaway board, under the Owner Giveaway portal's rules: drafts first
        (random draws seal their commitment at creation), funding only from a verified source — $STONER funds
        against the Reward Wallet's real balance (<strong className="text-[var(--text)]">{data.rewardWalletBalance} $STONER held</strong>),
        USD stays gated on the payment rails — and distribution pays each winner once, from the wallet, with
        the payout recorded per winner. Winners are notified in-app and by email.
      </p>

      <div className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-3">
        <span className={LABEL}>New campaign</span>
        <div className="flex gap-2">
          <select className="w-28 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2.5" value={currency} onChange={(e) => setCurrency(e.target.value as "STONER" | "USD")} aria-label="Giveaway currency">
            <option value="STONER">$STONER</option>
            <option value="USD">USD</option>
          </select>
          <input className={INPUT} inputMode="decimal" value={pot} onChange={(e) => setPot(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Pot amount" aria-label="Giveaway pot amount" />
          <select className="w-32 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2.5" value={mode} onChange={(e) => setMode(e.target.value as "selected" | "random")} aria-label="Giveaway mode">
            <option value="selected">Hand-picked</option>
            <option value="random">Random draw</option>
          </select>
        </div>
        {mode === "random" ? (
          <input className={`${INPUT} mt-2`} inputMode="numeric" value={winnerCount} onChange={(e) => setWinnerCount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="How many winners" aria-label="Giveaway winner count" />
        ) : (
          <select className={`${INPUT} mt-2`} value={split} onChange={(e) => setSplit(e.target.value as "equal" | "per_driver")} aria-label="Giveaway split">
            <option value="equal">Split the pot equally</option>
            <option value="per_driver">Per-driver amounts (must add up to the pot)</option>
          </select>
        )}
        <textarea
          className={`${INPUT} mt-2`}
          rows={4}
          value={recipientsText}
          onChange={(e) => setRecipientsText(e.target.value)}
          placeholder={"One per line: username, 0x payout address" + (split === "per_driver" && mode === "selected" ? ", amount" : "")}
          aria-label="Giveaway recipients, one per line: username, payout address, optional amount"
        />
        <input className={`${INPUT} mt-2`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Distribution note (optional)" aria-label="Giveaway distribution note" />
        <button
          type="button"
          disabled={busy || !(Number(pot) > 0) || !recipientsText.trim()}
          className="btn-neon mt-2 w-full rounded-lg px-4 py-2.5 font-bold disabled:opacity-50"
          aria-label="Create team giveaway"
          onClick={create}
        >
          Create giveaway (draft)
        </button>
      </div>

      <ul className="mt-3 space-y-1.5">
        {data.giveaways.map((g: TeamGiveaway) => (
          <li key={g.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 text-sm">
                <span className="block font-bold">
                  #{g.id} · {g.potAmount} {g.currency} · {g.mode === "random" ? `Random draw (${g.winnerCount ?? "?"} winners)` : "Hand-picked"}
                </span>
                <span className="block text-xs text-[var(--dim)]">
                  Hosted by @{g.createdBy} · created {fmtDate(g.createdAt)}
                  {g.fundingSource ? ` · funded from ${g.fundingSource}` : ""}
                  {g.commitmentHash ? " · commitment sealed" : ""}
                  {g.drawSeed ? " · draw sealed" : ""}
                </span>
                {g.distributionNote && <span className="block text-xs text-[var(--dim)]">{g.distributionNote}</span>}
              </span>
              <StatusChip status={g.status === "funded" || g.status === "distributed" ? "active" : g.status === "cancelled" ? "suspended" : "locked"} />
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--dim)]">
              {g.recipients.map((r) => (
                <li key={r.id}>
                  @{r.username} — {r.isWinner ? `🏆 ${r.amount} ${g.currency}` : "entrant"}
                  {r.paidAt ? ` · paid ${fmtDate(r.paidAt)}` : ""}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              {g.status === "draft" && (
                <button type="button" disabled={busy} className="btn-neon rounded-lg px-3.5 py-1.5 text-sm font-bold disabled:opacity-50" aria-label={`Fund giveaway ${g.id}`} onClick={() => void onRun(() => api.teamFundGiveaway({ giveawayId: g.id }), `Giveaway #${g.id} funded from the Reward Wallet.`)}>Fund</button>
              )}
              {g.mode === "random" && !g.drawSeed && (g.status === "draft" || g.status === "funded") && (
                <button type="button" disabled={busy} className="rounded-lg bg-[var(--surface)] px-3.5 py-1.5 text-sm font-bold disabled:opacity-50" aria-label={`Run draw for giveaway ${g.id}`} onClick={() => void onRun(() => api.teamDrawGiveaway({ giveawayId: g.id }), `Draw for giveaway #${g.id} is sealed — winners are on the record.`)}>Run draw</button>
              )}
              {g.status === "funded" && (
                <button type="button" disabled={busy} className="btn-neon rounded-lg px-3.5 py-1.5 text-sm font-bold disabled:opacity-50" aria-label={`Distribute giveaway ${g.id}`} onClick={() => void onRun(() => api.teamDistributeGiveaway({ giveawayId: g.id }), `Giveaway #${g.id} distributed — winners paid and notified.`)}>Distribute</button>
              )}
              {(g.status === "draft" || g.status === "funded") && (
                <button type="button" disabled={busy} className="rounded-lg bg-[var(--surface)] px-3.5 py-1.5 text-sm font-bold text-[var(--danger)] disabled:opacity-50" aria-label={`Cancel giveaway ${g.id}`} onClick={() => void onRun(() => api.teamCancelGiveaway({ giveawayId: g.id }), `Giveaway #${g.id} cancelled.`)}>Cancel</button>
              )}
            </div>
          </li>
        ))}
        {data.giveaways.length === 0 && (
          <li className="rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">No team giveaways yet — create the first campaign above.</li>
        )}
      </ul>
    </div>
  );
}

/** The user's own view of team activity on THEIR account — the
 *  transparency surface: change notices (with the email outcome),
 *  pending approval requests (password / personal-info help ONLY),
 *  and team giveaways they're entered in. Renders nothing until the
 *  team has actually touched this account. */
export function MyTeamActivityCard({ setBanner }: { setBanner: (s: string | null) => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["my-team-activity"], queryFn: () => api.getMyTeamActivity({}) });
  const [busy, setBusy] = useState(false);
  // Consent-window approvals: the user picks the exact item from their
  // OWN lists (the team never picks it) and separately allows editing.
  const pendingItemWindows = (q.data?.itemWindows ?? []).filter((w) => w.status === "pending");
  const [itemPick, setItemPick] = useState<Record<number, number>>({});
  const [itemEditOk, setItemEditOk] = useState<Record<number, boolean>>({});
  const entriesPickQuery = useQuery({
    queryKey: ["team-picker-pay-entries"],
    queryFn: () => api.listPayEntries({ limit: 100 }),
    enabled: pendingItemWindows.some((w) => w.itemKind === "pay_entry"),
  });
  const stubsPickQuery = useQuery({
    queryKey: ["team-picker-stubs"],
    queryFn: () => api.listReceivedStubs({}),
    enabled: pendingItemWindows.some((w) => w.itemKind === "pay_stub"),
  });
  const docsPickQuery = useQuery({
    queryKey: ["team-picker-docs"],
    queryFn: () => api.listFiledDocCopies({ limit: 50 }),
    enabled: pendingItemWindows.some((w) => w.itemKind === "document"),
  });
  const data = q.data;
  if (!data) return null;
  if (data.notices.length === 0 && data.consentRequests.length === 0 && data.giveaways.length === 0 && data.itemWindows.length === 0) return null;
  const pending = data.consentRequests.filter((r) => r.status === "pending");
  const unread = data.notices.some((n) => !n.read);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["my-team-activity"] });
    void queryClient.invalidateQueries({ queryKey: ["team-consent"] });
    void queryClient.invalidateQueries({ queryKey: ["team-item-windows"] });
  };
  const decideItem = (w: ItemWindow, approve: boolean) => {
    setBusy(true);
    void api
      .decideItemConsent({
        windowId: w.id,
        approve,
        itemId: approve ? (itemPick[w.id] ?? null) : null,
        canEdit: approve ? (itemEditOk[w.id] ?? false) : false,
      })
      .then((r) => {
        setBanner(
          r.ok
            ? approve
              ? `Window open — @${w.teamSeat} can see that one item for 30 minutes. Revoke it any time below.`
              : "Denied — nothing opened."
            : (r.error ?? "That didn't go through."),
        );
        if (r.ok) refresh();
      })
      .catch(() => setBanner("That didn't go through — try again."))
      .finally(() => setBusy(false));
  };
  const revokeItem = (w: ItemWindow) => {
    setBusy(true);
    void api
      .revokeItemConsent({ windowId: w.id })
      .then((r) => {
        setBanner(r.ok ? "Window closed — the session record is on its way to your email." : (r.error ?? "That didn't go through."));
        if (r.ok) refresh();
      })
      .catch(() => setBanner("That didn't go through — try again."))
      .finally(() => setBusy(false));
  };
  const decide = (requestId: number, approve: boolean) => {
    setBusy(true);
    void api
      .decideTeamConsent({ requestId, approve })
      .then((r) => {
        setBanner(r.ok ? (approve ? "Approved — the team can now apply exactly that change, once." : "Denied — no change will be made.") : (r.error ?? "That didn't go through."));
        if (r.ok) refresh();
      })
      .catch(() => setBanner("That didn't go through — try again."))
      .finally(() => setBusy(false));
  };
  return (
    <section className="glass-panel p-3.5" aria-label="Team changes to your account">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-condensed text-xl font-semibold">🛠️ Team changes to your account</h2>
        {unread && (
          <button
            type="button"
            className="shrink-0 text-sm font-bold text-[var(--accent)]"
            aria-label="Mark team notices read"
            onClick={() => {
              void api.markMyTeamNoticesRead({}).then(() => refresh());
            }}
          >
            Mark read
          </button>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        When the STONEMILES team changes anything on your account, it shows here and in your email — who did
        it, what changed, when. Team contact — Stonervision team — brokers, shippers &amp; help:{" "}
        <a href={`mailto:${data.teamEmail}`} className="font-bold text-[var(--accent)] underline" aria-label={`Email the Stonervision team — brokers, shippers and help — at ${data.teamEmail}`}>
          {data.teamEmail}
        </a>{" "}
        — the Stonervision team's own mailbox, covering brokers, shippers &amp; help; team notices and consent closeouts are addressed from it. The
        team sees account shells only. Your Pay Book, pay stubs, and documents open ONLY inside a 30-minute
        consent window you approve below, for one item you pick — and your messages, password, and keys never
        open at all.
      </p>

      {pending.length > 0 && (
        <div className="mt-3 space-y-2">
          {pending.map((r) => (
            <div key={r.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
              <div className="text-sm font-bold">
                {r.kind === "password_reset" ? "Approval asked: password / PIN reset help" : "Approval asked: personal-info changes"}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">{r.detail}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                Asked by @{r.requestedBy} · {fmtWhen(r.createdAt)}. Approving covers ONLY this — it doesn't
                open your Pay Book, stubs, documents, messages, or keys (those open only inside a separate
                one-item consent window, below), and for a password reset the team triggers it but never sees
                or sets your new PIN. No approval = no change.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="btn-neon rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
                  aria-label={`Approve team request ${r.id}`}
                  onClick={() => decide(r.id, true)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg bg-[var(--surface)] px-4 py-2 text-sm font-bold disabled:opacity-50"
                  aria-label={`Deny team request ${r.id}`}
                  onClick={() => decide(r.id, false)}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.consentRequests.filter((r) => r.status !== "pending").length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-[var(--dim)]">
          {data.consentRequests
            .filter((r) => r.status !== "pending")
            .slice(0, 5)
            .map((r) => (
              <li key={r.id}>
                {r.kind === "password_reset" ? "Password / PIN reset help" : "Personal-info changes"} — {r.status}
                {r.decidedAt ? ` · answered ${fmtWhen(r.decidedAt)}` : ""}
              </li>
            ))}
        </ul>
      )}

      {data.itemWindows.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Sensitive-item access</div>
          <div className="mt-1.5 space-y-2">
            {data.itemWindows.map((w) => {
              const options =
                w.itemKind === "pay_entry"
                  ? (entriesPickQuery.data?.entries ?? []).map((e) => ({
                      id: e.id,
                      label: `${e.payer} · ${e.kind === "w2" ? "W-2" : "1099"}${e.isForm ? " form" : ""} · ${fmtDate(e.paidAt)} · $${e.gross.toFixed(2)}`,
                    }))
                  : w.itemKind === "pay_stub"
                    ? (stubsPickQuery.data?.deliveries ?? []).map((d) => ({
                        id: d.id,
                        label: `${d.companyName} · ${d.kind === "w2" ? "W-2" : "1099"} ${d.deliveryType === "form" ? "form" : "stub"} · ${fmtDate(d.paidAt)} · $${d.gross.toFixed(2)}`,
                      }))
                    : (docsPickQuery.data?.copies ?? []).map((c) => ({ id: c.id, label: c.label }));
              return (
                <div key={w.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
                  <div className="font-bold">
                    {w.itemKind === "pay_entry" ? "Pay Book entry" : w.itemKind === "pay_stub" ? "Pay stub" : "Document"} — {w.status}
                    {w.status === "active" && w.expiresAt ? ` · closes ${fmtWhen(w.expiresAt)}` : ""}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                    {w.itemLabel ?? `“${w.description}”`} · seat @{w.teamSeat}
                    {w.status !== "pending" ? (w.canEdit ? " · view + edit approved" : " · view only") : ""}
                  </p>
                  {w.status === "pending" && (
                    <>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                        @{w.teamSeat} asked in their words: “{w.description}”. The request opened nothing. If you
                        approve, YOU pick the exact item — the window covers that one item, for that one seat,
                        for 30 minutes. Approval only counts here, in your app — never by phone or email.
                      </p>
                      <label className="mt-2 block text-xs font-semibold text-[var(--dim)]" htmlFor={`item-pick-${w.id}`}>
                        Pick the exact item
                      </label>
                      <select
                        id={`item-pick-${w.id}`}
                        className="mt-1 w-full rounded-lg bg-[var(--surface)] px-3 py-2.5 text-base"
                        value={itemPick[w.id] ?? ""}
                        onChange={(e) => setItemPick({ ...itemPick, [w.id]: Number(e.target.value) })}
                        aria-label={`Pick the exact ${w.itemKind === "pay_entry" ? "Pay Book entry" : w.itemKind === "pay_stub" ? "pay stub" : "document"} for window ${w.id}`}
                      >
                        <option value="">Choose one of your items…</option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {options.length === 0 && (
                        <p className="mt-1 text-xs text-[var(--dim)]">No matching item found in your account to pick.</p>
                      )}
                      {w.itemKind === "pay_entry" ? (
                        <label className="mt-2 flex items-start gap-2 text-xs leading-relaxed">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0"
                            checked={itemEditOk[w.id] ?? false}
                            onChange={(e) => setItemEditOk({ ...itemEditOk, [w.id]: e.target.checked })}
                            aria-label={`Also allow editing in window ${w.id}`}
                          />
                          <span>
                            Also allow EDITING this entry's deduction lines. Separate approval — viewing never
                            implies editing. Leave unchecked for view-only.
                          </span>
                        </label>
                      ) : (
                        <p className="mt-1 text-xs text-[var(--dim)]">Stubs and documents are sealed copies — view only; they can't be edited.</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={busy || !itemPick[w.id]}
                          className="btn-neon rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
                          aria-label={`Approve the 30-minute window ${w.id}`}
                          onClick={() => decideItem(w, true)}
                        >
                          Approve 30 min
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg bg-[var(--surface)] px-4 py-2 text-sm font-bold disabled:opacity-50"
                          aria-label={`Deny the access request ${w.id}`}
                          onClick={() => decideItem(w, false)}
                        >
                          Deny
                        </button>
                      </div>
                    </>
                  )}
                  {w.status === "active" && (
                    <button
                      type="button"
                      disabled={busy}
                      className="mt-2 rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                      aria-label={`Revoke window ${w.id} now`}
                      onClick={() => revokeItem(w)}
                    >
                      Revoke now
                    </button>
                  )}
                  {w.accesses.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-[var(--dim)]">
                      {w.accesses.map((a, i) => (
                        <li key={i}>
                          {a.kind === "edit" ? "✏️ Edited" : "👁 Viewed"} — {a.detail} · {fmtWhen(a.at)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {w.status !== "pending" && w.status !== "active" && w.accesses.length === 0 && (
                    <p className="mt-1 text-xs text-[var(--dim)]">Session record: nothing was opened in this window.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.notices.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {data.notices.slice(0, 10).map((n) => (
            <li key={n.id} className={`rounded-xl px-3 py-2.5 text-sm ${n.read ? "bg-[var(--surface2)]" : "bg-[var(--surface2)] ring-1 ring-[var(--accent)]"}`}>
              <span className="font-bold">{n.summary}</span>
              <span className="text-[var(--dim)]"> — by @{n.actor} · {fmtWhen(n.createdAt)}</span>
              {n.detail && <span className="block text-xs leading-relaxed text-[var(--dim)]">{n.detail}</span>}
              <span className="block text-xs text-[var(--dim)]">
                From team: {n.teamEmail} · Email: {n.emailStatus === "sent" ? "sent" : n.emailStatus === "queued" ? "queued (no mail provider connected yet)" : n.emailStatus === "no_address" ? "no email address on file" : "send failed — this in-app notice is the record"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.giveaways.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Team giveaways you're in</div>
          <ul className="mt-1.5 space-y-1 text-sm">
            {data.giveaways.map((g) => (
              <li key={g.id} className="rounded-lg bg-[var(--surface2)] px-3 py-2">
                Giveaway #{g.id} — {g.potAmount} {g.currency} pot · {g.status}
                {g.isWinner ? ` · 🏆 your share: ${g.myAmount} ${g.currency}${g.paidAt ? ` · paid ${fmtDate(g.paidAt)}` : ""}` : " · entered"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
