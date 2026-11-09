import { spaceQueryClient } from "@hatch/space-sdk/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import { installHealthReporter } from "./healthReporter";
import "./theme.css";
import appIcon180 from "./assets/app-icon-180.png";
import appIcon192 from "./assets/app-icon-192.png";
import appIcon512 from "./assets/app-icon-512.png";
import appIconMaskable512 from "./assets/app-icon-maskable-512.png";

// Installable home-screen app: inject the web app manifest (standalone
// display, cab-dark splash/theme colors matching the brand tokens, the
// Chain Seal icon set — 192/512 for Android & Chrome, a padded maskable
// 512, and the 180 Apple touch icon) so drivers can put STONEMILES on
// their home screen: full-screen, own icon, no browser chrome. The rest
// of the head wiring (theme-color, capable metas) lives in index.html.
// All app logic is client-side + typed server actions, so a native
// wrapper (e.g. Capacitor) can package this same build without a rewrite.
try {
  const manifest = {
    name: "STONEMILES by Stonervision",
    short_name: "STONEMILES",
    description:
      "Truck GPS for semis: truck-legal routes, restriction alerts, fuel stops, and a state-by-state trip sheet.",
    start_url: ".",
    scope: ".",
    display: "standalone",
    orientation: "portrait",
    background_color: "#050a1a",
    theme_color: "#050a1a",
    icons: [
      { src: appIcon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: appIcon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: appIconMaskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  const blob = new Blob([JSON.stringify(manifest)], {
    type: "application/manifest+json",
  });
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = URL.createObjectURL(blob);
  document.head.appendChild(link);
  const touch = document.createElement("link");
  touch.rel = "apple-touch-icon";
  touch.href = appIcon180;
  document.head.appendChild(touch);
} catch {
  // Manifest injection is progressive enhancement; the app runs without it.
}

// Android/Chrome install prompt: capture beforeinstallprompt whenever the
// browser offers it and stash it for the Settings → “Get the app” section
// (the browser only fires this once, early — a React component mounting
// later would miss it). `appinstalled` clears the stash. Presentation
// only: this never touches app data or behavior.
try {
  const w = window as unknown as {
    __smInstallPrompt: Event | null;
  };
  w.__smInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    w.__smInstallPrompt = e;
    window.dispatchEvent(new Event("sm-install-prompt-ready"));
  });
  window.addEventListener("appinstalled", () => {
    w.__smInstallPrompt = null;
    window.dispatchEvent(new Event("sm-app-installed"));
  });
} catch {
  // No install prompt on this browser (e.g. iOS Safari) — Settings shows
  // the manual Add to Home Screen steps instead.
}

// In-app-view detection (road test #4, 2026-10-30): inside the Muse
// shell the app runs in an iframe whose bottom bar floats over the
// page and covered the map's bottom controls. Embedded → theme.css
// raises --map-bottom-reserve so those controls lift clear of the
// shell bar. A standalone / app-store build runs top-level, never
// gets the attribute, and keeps the original bottom layout exactly.
try {
  if (window.self !== window.top) {
    document.documentElement.dataset.appView = "embedded";
  }
} catch {
  // A cross-origin parent that refuses the comparison IS an embed.
  document.documentElement.dataset.appView = "embedded";
}

// Appearance + font size apply before first paint from the on-device
// cache of the driver's Settings (the server copy loads right after and
// wins on any disagreement). Dark is the default; "Follow device"
// resolves through the system color scheme.
try {
  const appearance = localStorage.getItem("tgps-appearance") ?? "dark";
  const resolved =
    appearance === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : appearance;
  document.documentElement.dataset.theme = resolved === "light" ? "light" : "dark";
  const font = localStorage.getItem("tgps-font-size") ?? "standard";
  document.documentElement.dataset.font =
    font === "large" || font === "xlarge" ? font : "standard";
} catch {
  document.documentElement.dataset.theme = "dark";
}

// Self-reporting (owner order 2026-11-05): installed before the
// first render so window errors + unhandled rejections from any
// point in the app's life report themselves to the health inbox
// (Driver → Live Updates). The reporter never throws and sends
// sanitized error text + screen name only — see healthReporter.ts.
installHealthReporter();

const rootEl = document.querySelector<HTMLElement>("[data-generated-space-root]");
if (!rootEl) {
  throw new Error("missing generated space root element");
}

// If you edit this file: keep `<QueryClientProvider client={spaceQueryClient}>`
// wrapping the app (every space shares the SDK's QueryClient), and keep
// BOTH the `hatch-space-root` class AND the `data-hatch-space-root`
// attribute on the outer div. The SDK styles select on
// `.hatch-space-root[data-hatch-space-root]` to apply mobile safe-area
// insets (notches, gesture bars, etc.), correct viewport sizing, and the
// hosting header/chrome offsets — dropping either breaks layout silently.
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={spaceQueryClient}>
      <div className="hatch-space-root" data-hatch-space-root>
        <AuthGate>
          <App />
        </AuthGate>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
