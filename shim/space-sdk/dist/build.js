// Canonical client bundler — STANDALONE SHIM for "@hatch/space-sdk/build".
//
// Same bundling as the hosted SDK's dist/build.js (SDK 0.14.0):
// Bun.build on ./client/index.html → ./client/dist with minify,
// NODE_ENV=production define, naming {asset/chunk:
// "assets/[name]-[hash].[ext]", entry: "[name].[ext]"}, the
// bun-plugin-tailwind plugin, a re-prefix pass that rewrites bare
// `./<assetfile>` URLs in emitted js/css/html to `./assets/<assetfile>`,
// and a pdfjs-assets copy when the bundle references ./assets/pdfjs/.
//
// Standalone differences:
//   1. NO builder-environment guard. The real buildClient refuses to
//      run outside the artifact builder because a hand build would
//      not publish the live artifact. This copy is a separate,
//      owner-authorized standalone tree (the re-platform), where a
//      hand build is exactly the point — the live artifact pipeline
//      is untouched.
//   2. pdfjs-assets source: the hosted SDK carries vendored assets at
//      dist/pdfjs-assets/<version>/ (cmaps, standard_fonts, wasm).
//      This shim's PdfViewer does not reference ./assets/pdfjs/ (its
//      worker is a Blob URL), but the app's own pdfDoc.ts reader
//      does, so the copy step is still required. Resolution order:
//      (a) a vendored dist/pdfjs-assets directory beside this file,
//      copied as-is like the real build; otherwise (b) assemble
//      assets/pdfjs/<version>/ from the app's pdfjs-dist package
//      (same 5.4.624 payload: its cmaps/, standard_fonts/, wasm/
//      directories), with the version read from that package.

import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";
const ENTRY = "./client/index.html";
const OUTDIR = "./client/dist";
const PDFJS_ASSET_ROOT = "./assets/pdfjs/";
async function exists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
async function copyPdfjsAssets() {
    const vendored = join(import.meta.dir, "pdfjs-assets");
    if (await exists(vendored)) {
        await cp(vendored, join(OUTDIR, "assets", "pdfjs"), {
            recursive: true,
        });
        return;
    }
    // Assemble from the app's pdfjs-dist package. This build runs
    // from the standalone project root (client/build.mjs), and the
    // package also resolves upward from this file; try both anchors.
    const candidates = [
        join(process.cwd(), "node_modules", "pdfjs-dist"),
        join(import.meta.dir, "..", "..", "..", "node_modules", "pdfjs-dist"),
    ];
    for (const pkgDir of candidates) {
        if (!(await exists(join(pkgDir, "cmaps")))) {
            continue;
        }
        let version = "5.4.624";
        try {
            const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"));
            if (typeof pkg.version === "string" && pkg.version.length > 0) {
                version = pkg.version;
            }
        }
        catch {
            // Keep the pinned fallback version.
        }
        const dest = join(OUTDIR, "assets", "pdfjs", version);
        await mkdir(dest, { recursive: true });
        for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
            const src = join(pkgDir, dir);
            if (await exists(src)) {
                await cp(src, join(dest, dir), { recursive: true });
            }
        }
        return;
    }
    throw new Error("buildClient(): bundle references ./assets/pdfjs/ but no pdfjs assets were found (no vendored dist/pdfjs-assets and no pdfjs-dist package with cmaps/)");
}
export async function buildClient(_options = {}) {
    if (typeof Bun === "undefined" || typeof Bun.build !== "function") {
        throw new Error("buildClient() must run under Bun");
    }
    await rm(OUTDIR, { force: true, recursive: true });
    const result = await Bun.build({
        entrypoints: [ENTRY],
        outdir: OUTDIR,
        minify: true,
        define: {
            "process.env.NODE_ENV": JSON.stringify("production"),
        },
        naming: {
            asset: "assets/[name]-[hash].[ext]",
            chunk: "assets/[name]-[hash].[ext]",
            entry: "[name].[ext]",
        },
        plugins: [tailwindPlugin],
    });
    if (!result.success) {
        for (const log of result.logs) {
            console.error(log);
        }
        throw new Error("buildClient() failed; see logged diagnostics");
    }
    // Bun writes imported assets to `naming.asset` (`assets/<name>-<hash>.<ext>`)
    // but emits the JS/CSS import URL as a bare `./<name>-<hash>.<ext>` — without
    // the `assets/` directory prefix. Re-prefix only the bare imported-asset
    // URLs to `./assets/...`. This is idempotent (`./assets/<f>` does not
    // contain `./<f>`) and never rewrites chunk refs. Keep `assets/` in sync
    // with `naming.asset` above. (Comment carried from the real build.)
    const assetFiles = result.outputs
        .filter((output) => output.kind === "asset")
        .map((output) => basename(output.path));
    let needsPdfjsAssets = false;
    for (const output of result.outputs) {
        if (!/\.(js|css|html)$/.test(output.path)) {
            continue;
        }
        let text = await output.text();
        needsPdfjsAssets ||= text.includes(PDFJS_ASSET_ROOT);
        let changed = false;
        for (const name of assetFiles) {
            const bare = `./${name}`;
            if (text.includes(bare)) {
                text = text.split(bare).join(`./assets/${name}`);
                changed = true;
            }
        }
        if (changed) {
            await Bun.write(output.path, text);
        }
    }
    if (needsPdfjsAssets) {
        await copyPdfjsAssets();
    }
}
