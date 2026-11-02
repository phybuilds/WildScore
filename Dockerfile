FROM node:24.22.2-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package.json package-lock.json .node-version ./
RUN npm ci --ignore-scripts

COPY bin ./bin
COPY scripts ./scripts
COPY src ./src
COPY web ./web

RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY --from=build --chown=101:101 /app/web/out /usr/share/nginx/html

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
