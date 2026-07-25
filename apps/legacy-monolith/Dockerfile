FROM node:22.13.0-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
COPY packages/ ./packages/
COPY apps/legacy-monolith/ ./apps/legacy-monolith/
RUN npm ci --workspace=@workhub/legacy-monolith --include-workspace-root

FROM node:22.13.0-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app ./
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/legacy-monolith/server.js"]
