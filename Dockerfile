# STONEMILES standalone host — Phase 1 (Render deploy is Phase 2).
# `bun run start` applies drizzle migrations, then serves on $PORT (default 8787).
FROM oven/bun:1.3.10
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY shim ./shim
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN bun run build
ENV NODE_ENV=production
EXPOSE 8787
CMD ["bun", "run", "start"]
