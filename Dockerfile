# STONEMILES standalone host — Phase 1 (Render deploy is Phase 2).
# `bun run start` applies drizzle migrations, then serves on $PORT (default 8787).
FROM oven/bun:1.3.10
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY shim ./shim
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN bun run build
# Round 3: bundle the host server to a single file at image build time.
# The container boots the BUNDLE (see render.yaml dockerCommand), not the
# TypeScript source — no in-container transpilation of the 262-module
# graph, no tsconfig/path resolution, one file read at startup. The
# bundle must sit directly in host/ (not a subdir): ctx.ts derives the
# standalone root from import.meta.dir, and a deeper path breaks it.
RUN bun build host/server.ts --target=bun --outfile=host/server.bundle.js
ENV NODE_ENV=production
EXPOSE 8787
CMD bun run host/migrate.ts && bun run host/server.bundle.js
