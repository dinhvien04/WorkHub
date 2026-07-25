FROM node:22.13.0-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
COPY packages/ ./packages/
COPY apps/api-gateway/ ./apps/api-gateway/
RUN npm ci --workspace=@workhub/api-gateway --include-workspace-root

FROM node:22.13.0-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api-gateway/server.js"]
