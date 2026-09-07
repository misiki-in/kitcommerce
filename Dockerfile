# Bun is the runtime, not just the build tool: the app uses bun:sqlite for both
# the database and the job queue, so node cannot run the output.
FROM oven/bun:1.4-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun --bun vite build

FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
# Keeps the SQLite file, uploads and the generated encryption key on a mounted
# volume rather than inside the container layer, which a redeploy discards.
ENV OC_DATA_DIR=/app/data

# adapter-node output plus the source the migration runner reads. Nothing is
# imported at run time that Bun does not already provide, so no node_modules.
COPY --from=build /app/build ./build
COPY --from=build /app/src ./src
COPY --from=build /app/static ./static
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /app/data
EXPOSE 3000

# The schema lives in one file applied on every boot; it is idempotent, so a
# restart on an existing volume is a no-op and a fresh volume gets a database.
CMD ["sh", "-c", "bun src/migrate.ts && bun build/index.js"]
