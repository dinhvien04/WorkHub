# WorkHub production image
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:css || true

FROM base AS runner
ENV NODE_ENV=production
ENV USE_TAILWIND_CDN=0
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
