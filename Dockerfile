# Web app image for Render (or any container host). Holds no keys: config.js is generated at start-up from
# SUPABASE_URL / SUPABASE_ANON_KEY (anon/publishable key only — the server refuses service_role keys).
# Build for Render's x86 machines, even on an Apple Silicon Mac:
#   docker buildx build --platform linux/amd64 -t <dockerhub-user>/aie313-hospital-web:latest --push .
FROM node:22-alpine
ENV NODE_ENV=production PORT=10000
WORKDIR /app
COPY scripts/write-config.mjs scripts/serve.mjs ./scripts/
COPY web ./web
# COPY keeps the files' permissions from the build machine. A checkout on macOS can be owner-only (-rw-------), and the
# files belong to root here, so the node user could not read them (EACCES on start). Make the app world-readable,
# read-only for everyone except root.
RUN chmod -R a+rX,go-w /app
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "scripts/serve.mjs"]
