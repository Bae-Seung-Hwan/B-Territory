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
# seed:spots(ts-node)가 scripts/seed-spots-csv.ts를 실행하므로 함께 담는다.
# CSV(data/mission_places_final.csv)는 빌드 컨텍스트(backend/) 밖이라 이미지에 넣지 못하고,
# 런타임에 docker-compose가 호스트 data/를 /data로 읽기전용 마운트해 제공한다.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# node:alpine에 기본 포함된 비특권 사용자로 실행해 컨테이너 공격 표면을 줄인다.
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
