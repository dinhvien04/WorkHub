FROM node:22.13.0-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
COPY packages/ ./packages/
COPY services/identity-service/ ./services/identity-service/
RUN npm ci --workspace=@workhub/identity-service --include-workspace-root

FROM node:22.13.0-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app ./
ENV NODE_ENV=production
EXPOSE 3004
CMD ["node", "services/identity-service/server.js"]
