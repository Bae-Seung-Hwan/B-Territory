FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# node_modules(전체, dev 포함)와 src를 그대로 유지 — migration:* 스크립트가
# ts-node/typeorm-ts-node-commonjs로 src/migrations/*.ts를 직접 실행한다.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
EXPOSE 3000
CMD ["node", "dist/main"]
