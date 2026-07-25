FROM node:22.13.0-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
COPY packages/ ./packages/
COPY services/communication-service/ ./services/communication-service/
RUN npm ci --workspace=@workhub/communication-service --include-workspace-root

FROM node:22.13.0-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app ./
ENV NODE_ENV=production
EXPOSE 3002
CMD ["node", "services/communication-service/server.js"]
