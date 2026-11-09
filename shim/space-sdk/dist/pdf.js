// PdfViewer — STANDALONE SHIM for "@hatch/space-sdk/pdf".
//
// Re-implements the hosted SDK's PdfViewer (SDK 0.14.0) on the app's
// own pdfjs-dist 5.4.624 dependency, with the same props, English
// label defaults, layout, and behavior as the real component:
//
//   - fetches `src` as bytes (credentials: "same-origin", abortable)
//     and hands them to PDF.js with evaluation disabled
//     (isEvalSupported: false, enableXfa: false);
//   - renders the current page to a <canvas>, scaled to the
//     container's width at a devicePixelRatio-aware scale (DPR
//     capped at 2, as in the real component);
//   - prev/next buttons + page indicator appear only for multi-page
//     documents; initialPage is clamped into the document;
//   - loading / loadError / pageError states use the labels props
//     with the SDK's English defaults.
//
// Worker approach (standalone difference): the hosted SDK bundles
// PDF.js's worker handler inline and runs the main-thread ("fake
// worker") fallback. Here the worker is imported as TEXT
// (`pdfjs-dist/build/pdf.worker.min.mjs` with { type: "text" }),
// turned into a Blob URL, and assigned to
// GlobalWorkerOptions.workerSrc, so PDF.js runs its real worker off
// that blob. Setting it at module scope also covers the app's own
// pdfDoc.ts reader, which imports "pdfjs-dist/build/pdf.mjs"
// directly and shares this GlobalWorkerOptions. If the Blob setup
// throws at runtime, the code falls back to importing the worker
// entry as a module (which registers globalThis.pdfjsWorker, PDF.js's
// main-thread fallback — the hosted SDK's own posture). If PDF.js
// still cannot start, the component degrades to the loadError label;
// it never throws into the app.

import { createElement, useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import workerText from "pdfjs-dist/build/pdf.worker.min.mjs" with { type: "text" };

let workerSetupPromise = null;
function ensurePdfWorker() {
    if (workerSetupPromise) {
        return workerSetupPromise;
    }
    workerSetupPromise = (async () => {
        try {
            // NOTE: GlobalWorkerOptions.workerSrc cannot be probed
            // for "unset" — pdfjs's getter substitutes the default
            // "./pdf.worker.mjs" when nothing was assigned. This
            // module owns the setup (guarded by workerSetupPromise),
            // so assign the Blob URL unconditionally, once.
            const blob = new Blob([workerText], { type: "text/javascript" });
            pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
            return;
        }
        catch {
            // Blob/workerSrc setup failed — fall through to the
            // main-thread fallback below.
        }
        try {
            // Registers globalThis.pdfjsWorker; PDF.js detects it and
            // runs its fake-worker fallback with no workerSrc needed.
            await import("pdfjs-dist/build/pdf.worker.mjs");
        }
        catch {
            // No worker at all: getDocument will reject and the
            // component shows the loadError label.
        }
    })();
    return workerSetupPromise;
}
// Kick the worker setup off at module load (the hosted SDK's pdf
// bundle likewise makes its worker handler available on import, and
// the app's pdfDoc reader relies on that side effect).
try {
    void ensurePdfWorker();
}
catch {
    // Guarded inside ensurePdfWorker; nothing here may break import.
}

const CONTAINER_STYLE = { display: "grid", gap: "0.75rem", width: "100%" };
const NAV_STYLE = { alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "center" };
const VIEWPORT_STYLE = { alignItems: "flex-start", display: "flex", justifyContent: "center", minHeight: "8rem", overflow: "auto", width: "100%" };
const STATUS_STYLE = { alignItems: "center", display: "flex", justifyContent: "center", minHeight: "8rem", textAlign: "center" };

function clampPage(page, totalPages) {
    return Math.min(totalPages, Math.max(1, Math.trunc(page) || 1));
}

export function PdfViewer({ src, ariaLabel = "PDF document", labels, initialPage = 1, className, style }) {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const [doc, setDoc] = useState(null);
    const [page, setPage] = useState(1);
    const [containerWidth, setContainerWidth] = useState(0);
    const [loadFailed, setLoadFailed] = useState(false);
    const [pageFailed, setPageFailed] = useState(false);
    const [rendering, setRendering] = useState(false);

    // Track the container width so the page scales to fit it.
    useEffect(() => {
        const el = containerRef.current;
        if (el === null) return;
        const update = () => setContainerWidth(Math.max(1, Math.floor(el.clientWidth)));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Fetch + open the document whenever src (or the requested first
    // page) changes.
    useEffect(() => {
        const controller = new AbortController();
        let loadingTask = null;
        let alive = true;
        setDoc(null);
        setLoadFailed(false);
        setPageFailed(false);
        setRendering(false);
        (async () => {
            const response = await fetch(src, { credentials: "same-origin", signal: controller.signal });
            if (!response.ok) {
                throw new Error(`PDF request failed with HTTP ${response.status}`);
            }
            const data = new Uint8Array(await response.arrayBuffer());
            await ensurePdfWorker();
            loadingTask = pdfjsLib.getDocument({
                data,
                enableXfa: false,
                isEvalSupported: false,
            });
            const loaded = await loadingTask.promise;
            if (!alive) {
                await loaded.destroy();
                return;
            }
            setPage(clampPage(initialPage, loaded.numPages));
            setDoc(loaded);
        })().catch((error) => {
            if (alive && !(error instanceof DOMException && error.name === "AbortError")) {
                setLoadFailed(true);
            }
        });
        return () => {
            alive = false;
            controller.abort();
            if (loadingTask !== null) {
                void loadingTask.destroy();
            }
        };
    }, [initialPage, src]);

    // Render the current page.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (doc === null || canvas === null || containerWidth <= 0) return;
        let alive = true;
        let renderTask = null;
        setPageFailed(false);
        setRendering(true);
        (async () => {
            const pdfPage = await doc.getPage(page);
            if (!alive) return;
            const base = pdfPage.getViewport({ scale: 1 });
            const scale = containerWidth / base.width;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const viewport = pdfPage.getViewport({ scale: scale * dpr });
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            canvas.style.width = `${Math.max(1, Math.floor(base.width * scale))}px`;
            canvas.style.height = `${Math.max(1, Math.floor(base.height * scale))}px`;
            renderTask = pdfPage.render({ canvas, viewport });
            await renderTask.promise;
            if (alive) setRendering(false);
        })().catch((error) => {
            if (alive && !(error instanceof Error && error.name === "RenderingCancelledException")) {
                setPageFailed(true);
                setRendering(false);
            }
        });
        return () => {
            alive = false;
            renderTask?.cancel();
        };
    }, [doc, containerWidth, page]);

    const goPrevious = useCallback(() => {
        setPage((current) => Math.max(1, current - 1));
    }, []);
    const goNext = useCallback(() => {
        setPage((current) => (doc === null ? current : Math.min(doc.numPages, current + 1)));
    }, [doc]);

    const status = loadFailed
        ? createElement("div", { role: "alert", style: STATUS_STYLE }, labels?.loadError ?? "This PDF couldn’t be loaded.")
        : doc === null
            ? createElement("div", { role: "status", style: STATUS_STYLE }, labels?.loading ?? "Loading PDF…")
            : pageFailed
                ? createElement("div", { role: "alert", style: STATUS_STYLE }, labels?.pageError ?? "This PDF page couldn’t be rendered.")
                : null;

    return createElement(
        "section",
        { "aria-label": ariaLabel, className, style: { ...CONTAINER_STYLE, ...style } },
        doc !== null && doc.numPages > 1
            ? createElement(
                "nav",
                { "aria-label": labels?.navigationAriaLabel ?? `${ariaLabel} pages`, style: NAV_STYLE },
                createElement("button", { type: "button", disabled: page <= 1, onClick: goPrevious }, labels?.previousPage ?? "Previous"),
                createElement("span", null, labels?.pageIndicator?.(page, doc.numPages) ?? `Page ${page} of ${doc.numPages}`),
                createElement("button", { type: "button", disabled: page >= doc.numPages, onClick: goNext }, labels?.nextPage ?? "Next"),
            )
            : null,
        createElement(
            "div",
            { ref: containerRef, style: VIEWPORT_STYLE },
            status,
            createElement("canvas", {
                ref: canvasRef,
                role: "img",
                "aria-label": labels?.pageAriaLabel?.(page, doc?.numPages ?? 1) ?? `${ariaLabel}, page ${page}`,
                "aria-busy": rendering,
                hidden: doc === null || loadFailed || pageFailed,
                style: { display: "block", maxWidth: "100%" },
            }),
        ),
    );
}
