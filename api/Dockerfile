FROM dockerproxy.net/library/node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM dockerproxy.net/library/node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
ARG APT_BUILD_PROXY
RUN if [ -n "$APT_BUILD_PROXY" ]; then export http_proxy="$APT_BUILD_PROXY" https_proxy="$APT_BUILD_PROXY"; fi; \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
