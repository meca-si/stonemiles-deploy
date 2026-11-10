// DeliveryCloseout.tsx — the delivery close-out panel on a load
// (2026-11-10). Three signature paths, first one wins:
//   1. Receive link — printed as a QR on the BOL; share/copy it here,
//      the desk can regenerate it (old token dies).
//   2. Sign on this phone — the receiver draws their signature here,
//      types their printed name; the image seals as the POD document.
//   3. Paper BOL — photograph the signed paper BOL; the photo is the
//      signed POD.
// Once any path lands, the panel shows the standing confirmation and
// the receiver-copy options (email via document mail, text from THIS
// device via the sms: handoff — no server SMS — or download/print).
// The standing GPS POD seal lives on the load card above this panel
// and stays the fallback.

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { buildSmsHandoff, isPlausibleMobile, maskPhone } from "./receiverCopy";

type LinkState = ApiResponse<typeof api, "getLoadReceiveLink">;

const PATH_LABELS: Record<string, string> = {
  receive_link: "Receiver confirmed on the receive link",
  phone_signature: "Receiver signed on the driver's phone",
  paper_bol: "Signed paper BOL (photo on file)",
  driver_pod: "Driver POD seal",
};

function pdfFromBase64(dataBase64: string, filename: string) {
  const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function SignaturePad({ onChange }: { onChange: (jpegBase64: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };
  const exportSig = () => {
    const canvas = canvasRef.current;
    if (!canvas || !dirty.current) return onChange(null);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    onChange(url.slice(url.indexOf(",") + 1));
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={600}
        height={180}
        className="w-full rounded-lg border border-[var(--border)] touch-none"
        style={{ background: "#fff" }}
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = canvasRef.current!.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          exportSig();
        }}
        onPointerLeave={() => {
          if (drawing.current) {
            drawing.current = false;
            exportSig();
          }
        }}
      />
      <button
        type="button"
        className="mt-1 text-xs font-bold text-[var(--dim)] underline"
        onClick={() => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          dirty.current = false;
          onChange(null);
        }}
      >
        Clear signature
      </button>
    </div>
  );
}

export function DeliveryCloseout({ loadId, setBanner }: { loadId: number; setBanner: (s: string) => void }) {
  const queryClient = useQueryClient();
  const linkQuery = useQuery({
    queryKey: ["load-receive-link", loadId],
    queryFn: () => api.getLoadReceiveLink({ loadId }),
  });
  const link: LinkState | undefined = linkQuery.data;
  const [receiverName, setReceiverName] = useState("");
  const [notes, setNotes] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [paperPhoto, setPaperPhoto] = useState<{ base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenArm, setRegenArm] = useState(false);
  const [copyEmail, setCopyEmail] = useState("");
  const [copyPhone, setCopyPhone] = useState("");
  const [copyMsg, setCopyMsg] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["load-receive-link", loadId] });
    void queryClient.invalidateQueries({ queryKey: ["loads"] });
    void queryClient.invalidateQueries({ queryKey: ["load-board"] });
    void queryClient.invalidateQueries({ queryKey: ["library"] });
  };

  if (linkQuery.isLoading) return <div className="mt-2 text-xs text-[var(--dim)]">Delivery close-out…</div>;
  if (!link || !link.ok) return null;

  const confirmed = link.confirmed;

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
      <div className="text-sm font-bold">📦 Delivery close-out</div>

      {confirmed ? (
        <div className="mt-2">
          <div className="font-semibold text-[var(--ok)]">
            ✅ Delivered — confirmed{link.receiverName ? ` by ${link.receiverName}` : ""}
            {link.path ? ` · ${PATH_LABELS[link.path] ?? link.path}` : ""}
            {link.confirmedAt ? ` · ${new Date(link.confirmedAt).toLocaleString()}` : ""}
          </div>
          {link.exceptionNotes && (
            <div className="mt-1 rounded-lg border border-amber-500/50 bg-amber-500/10 px-2 py-1 font-semibold text-amber-300">
              ⚠ Exceptions reported: {link.exceptionNotes}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
              onClick={() => {
                void api.getLibraryDocument({ ref: `pod:${loadId}` }).then((d) => {
                  if (d.ok && d.dataBase64) pdfFromBase64(d.dataBase64, d.filename ?? "document.pdf");
                  else setBanner(d.error ?? "The signed POD isn't available.");
                });
              }}
            >
              ⬇ Signed POD
            </button>
            <button
              type="button"
              className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
              onClick={() => {
                void api.getLibraryDocument({ ref: `bol:${loadId}` }).then((d) => {
                  if (d.ok && d.dataBase64) pdfFromBase64(d.dataBase64, d.filename ?? "document.pdf");
                  else setBanner(d.error ?? "The BOL isn't available.");
                });
              }}
            >
              🖨 Print BOL
            </button>
          </div>

          {(link.path === "receive_link" || link.path === "phone_signature") && (
            <div className="mt-3 border-t border-[var(--border)] pt-2">
              <div className="text-xs font-bold text-[var(--dim)]">RECEIVER'S OWN COPY — offer it once, it's skippable</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="email"
                  value={copyEmail}
                  onChange={(e) => setCopyEmail(e.target.value)}
                  placeholder="Receiver's email"
                  className="min-w-44 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
                />
                <button
                  type="button"
                  className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
                  onClick={() => {
                    if (!link.token || !copyEmail.includes("@")) return;
                    void api.emailReceiverCopy({ token: link.token, toEmail: copyEmail.trim() }).then((r) => {
                      setCopyMsg(r.ok ? (r.status === "queued" ? "Copy queued — mail is being set up." : "Copy emailed ✓") : (r.error ?? "Couldn't send."));
                    });
                  }}
                >
                  ✉ Email the copy
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="tel"
                  value={copyPhone}
                  onChange={(e) => setCopyPhone(e.target.value)}
                  placeholder="Receiver's mobile number"
                  className="min-w-44 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
                />
                {link.copyUrl && isPlausibleMobile(copyPhone) ? (
                  <a
                    href={buildSmsHandoff({ phone: copyPhone, fleetName: "your carrier", copyUrl: link.copyUrl }).href}
                    className="rounded-lg bg-[var(--ok)] px-3 py-2 text-xs font-bold text-black"
                    onClick={() => {
                      if (link.token) void api.logReceiverCopyTextOffer({ token: link.token, phone: copyPhone }).catch(() => undefined);
                      setCopyMsg(`Opening your Messages app — the copy link goes from YOUR number (${maskPhone(copyPhone)} is the receiver).`);
                    }}
                  >
                    💬 Text it from my phone
                  </a>
                ) : (
                  <button type="button" className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold opacity-50">
                    💬 Text it from my phone
                  </button>
                )}
                {link.copyUrl && (
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
                    onClick={() => {
                      const url = link.copyUrl!;
                      if (navigator.share) void navigator.share({ title: "Signed proof of delivery", url }).catch(() => undefined);
                      else void navigator.clipboard?.writeText(url).then(() => setCopyMsg("Copy link saved to clipboard."));
                    }}
                  >
                    ↗ Share copy link
                  </button>
                )}
              </div>
              {copyMsg && <div className="mt-1 text-xs text-[var(--dim)]">{copyMsg}</div>}
              <div className="mt-1 text-xs text-[var(--dim)]">The text sends from your own phone &amp; plan — STONEMILES never texts from a server. The link is view-only.</div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <div>
            <div className="text-xs font-bold text-[var(--dim)]">1 · RECEIVE LINK — the receiver confirms on their own phone</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-lg bg-[var(--surface)] px-2 py-2 text-xs">{link.url}</span>
              <button
                type="button"
                className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
                onClick={() => {
                  void navigator.clipboard?.writeText(link.url ?? "").then(() => setBanner("Receive link copied — text it to the receiver."));
                }}
              >
                📋 Copy link
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
                onClick={() => {
                  void api.getLibraryDocument({ ref: `bol:${loadId}` }).then((d) => {
                    if (d.ok && d.dataBase64) pdfFromBase64(d.dataBase64, d.filename ?? "document.pdf");
                    else setBanner(d.error ?? "The BOL isn't available.");
                  });
                }}
              >
                🖨 BOL (QR on it)
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold text-red-300"
                onClick={() => {
                  if (!regenArm) {
                    setRegenArm(true);
                    return;
                  }
                  setRegenArm(false);
                  void api.regenerateReceiveLink({ loadId }).then((r) => {
                    if (r.ok) {
                      setBanner("New receive link issued — the old one is dead.");
                      invalidate();
                    } else setBanner(r.error ?? "Couldn't regenerate.");
                  });
                }}
              >
                {regenArm ? "Tap again — kill the old link" : "↻ New link"}
              </button>
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-[var(--dim)]">2 · SIGN ON THIS PHONE — receiver signs here at the dock</div>
            <div className="mt-1">
              <SignaturePad onChange={setSignature} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                type="text"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder="Receiver's printed name"
                className="min-w-44 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
              />
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Exceptions (damage/shortage) — optional"
                className="min-w-44 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy || !signature || !receiverName.trim()}
                className="rounded-lg bg-[var(--ok)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
                onClick={() => {
                  if (!signature) return;
                  setBusy(true);
                  void api
                    .signDeliveryOnPhone({ loadId, receiverName: receiverName.trim(), exceptionNotes: notes.trim() || null, signatureDataBase64: signature, signatureMime: "image/jpeg" })
                    .then((r) => {
                      setBusy(false);
                      if (r.ok) {
                        setBanner(r.alreadyConfirmed ? "Already confirmed — the first close stands." : "Delivery sealed with the receiver's signature ✓");
                        invalidate();
                      } else setBanner(r.error ?? "Couldn't seal the delivery.");
                    })
                    .catch(() => {
                      setBusy(false);
                      setBanner("Couldn't seal the delivery — try again.");
                    });
                }}
              >
                ✍ Seal with this signature
              </button>
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-[var(--dim)]">3 · PAPER BOL — receiver signed the paper? Photograph it</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept="image/*"
                className="text-xs"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return setPaperPhoto(null);
                  const reader = new FileReader();
                  reader.onload = () => {
                    const s = String(reader.result ?? "");
                    setPaperPhoto({ base64: s.slice(s.indexOf(",") + 1), mime: f.type || "image/jpeg" });
                  };
                  reader.readAsDataURL(f);
                }}
              />
              <button
                type="button"
                disabled={busy || !paperPhoto || !receiverName.trim()}
                className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 py-2 text-sm font-bold disabled:opacity-50"
                onClick={() => {
                  if (!paperPhoto) return;
                  setBusy(true);
                  void api
                    .uploadSignedBolPod({ loadId, receiverName: receiverName.trim(), exceptionNotes: notes.trim() || null, photoDataBase64: paperPhoto.base64, photoMime: paperPhoto.mime })
                    .then((r) => {
                      setBusy(false);
                      if (r.ok) {
                        setBanner(r.alreadyConfirmed ? "Already confirmed — the first close stands." : "Delivery sealed with the signed BOL photo ✓");
                        invalidate();
                      } else setBanner(r.error ?? "Couldn't seal the delivery.");
                    })
                    .catch(() => {
                      setBusy(false);
                      setBanner("Couldn't seal the delivery — try again.");
                    });
                }}
              >
                📷 Seal with the signed BOL photo
              </button>
            </div>
            <div className="mt-1 text-xs text-[var(--dim)]">Uses the printed name + exceptions from step 2's fields. Whichever close lands first seals it — the others then show already-confirmed.</div>
          </div>
        </div>
      )}
    </div>
  );
}
