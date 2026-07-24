FROM node:22.13.0-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
COPY packages/ ./packages/
COPY services/content-service/ ./services/content-service/
RUN npm ci --workspace=@workhub/content-service --include-workspace-root

FROM node:22.13.0-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app ./
ENV NODE_ENV=production
EXPOSE 3003
CMD ["node", "services/content-service/server.js"]
