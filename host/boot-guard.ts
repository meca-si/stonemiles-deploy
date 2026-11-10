// Boot guard for the standalone host — imported FIRST by host/server.ts so
// its side effects run before the rest of the import graph evaluates.
//
// Why this exists: the first Render deploys died with "Application exited
// early" and zero application output — the process vanished before (or
// during) module evaluation and nothing was ever logged, which made the
// failure undiagnosable from the deploy logs. This module makes every
// future boot observable and keeps one stray async failure from taking
// the whole process down silently:
//   - prints a boot marker with runtime version, cwd and pid as soon as
//     module evaluation reaches this file;
//   - logs unhandled rejections / uncaught exceptions WITH stacks instead
//     of letting the process die without a trace (the server stays up —
//     a rejected background promise must not kill the web service);
//   - logs exit / SIGTERM / SIGINT so a platform-side kill is visible in
//     the log stream as a signal, not a mystery.
//
// Round 3 (2026-11-09): the marker now ALSO goes out via fs.writeSync on
// BOTH stdout and stderr. Round-3 diagnosis proved Bun's console.log into
// a PIPE is buffered — a process killed during boot lost every buffered
// line, which is why the Render deploys showed literally zero output even
// with this guard in place. writeSync is unbuffered: the marker either
// reaches the log stream immediately or the process died before this
// module evaluated at all. stderr gets a copy because deploy log
// pipelines have historically treated the two streams differently.

import { writeSync } from "node:fs";

const bootMarker =
  `[stonemiles-host] boot: module evaluation started ` +
  `(bun ${typeof Bun !== "undefined" ? Bun.version : "?"}, ` +
  `node-compat ${process.version}, pid ${process.pid}, cwd ${process.cwd()})`;
try {
  writeSync(1, bootMarker + "\n");
} catch {
  /* stdout unusable — stderr copy below still fires */
}
try {
  writeSync(2, bootMarker + "\n");
} catch {
  /* both streams unusable: nothing more userspace can do */
}

process.on("unhandledRejection", (reason) => {
  console.error("[stonemiles-host] unhandledRejection (process kept alive):", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[stonemiles-host] uncaughtException (process kept alive):", err);
});

process.on("exit", (code) => {
  console.log(`[stonemiles-host] exit: code ${code}`);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[stonemiles-host] received ${sig} — shutting down`);
    process.exit(0);
  });
}
