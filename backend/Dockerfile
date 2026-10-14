FROM node:20-bookworm-slim AS base
WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && npm ci && rm -rf /var/lib/apt/lists/*

FROM base AS dev
WORKDIR /app
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]

FROM base AS build
WORKDIR /app
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS prod
WORKDIR /app
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
RUN mkdir -p /app/uploads && groupadd -g 10001 appgroup && useradd -u 10001 -g appgroup -M appuser && chown -R appuser:appgroup /app
USER appuser
EXPOSE 4000
CMD ["npm", "run", "start"]
