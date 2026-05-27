# Dockerfile — 코드 리뷰
> 리뷰 레벨: 2
> [← INDEX.md](.review/CODE-REVIEW-Lv2/INDEX.md)

**파일 요약**
- 역할: Admin 서비스 컨테이너 빌드. 2-stage build (builder = native deps + nest build, runtime = 슬림 실행 이미지).
- 진입점 거리: 0 (entrypoint `node dist/main.js`)
- LOC: 17
- export: —
- 의존 모듈: `node:20-alpine`, apk(`python3 make g++`), npm
- 외부 패키지: better-sqlite3 native build (apk dev packages 필요)
- 부수효과: `mkdir -p /app/var` (SQLite 파일 기본 위치), `EXPOSE 8084`
- 동시성: N/A
- 테스트 커버리지: 없음

```dockerfile path=Dockerfile lines=1-17
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json tsconfig.json nest-cli.json ./
RUN npm install --no-fund --no-audit
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/var
EXPOSE 8084
CMD ["node", "dist/main.js"]
```

**분석 / Analysis (Level 2)**
- L1–7: builder stage. `apk add python3 make g++`은 `better-sqlite3` native(node-gyp) 빌드용. 알파인은 musl이라 prebuilt binary가 없어서 source build 필요.
- L4: `COPY package.json tsconfig.json nest-cli.json ./` — `package-lock.json`이 없으므로 의존 버전이 매 빌드 floating(^). 재현 가능한 빌드 보장 안 됨.
- L5: `npm install` 사용. `npm ci`가 정상이지만 lockfile 부재 때문에 부득이. 결국 같은 결과지만 cache 효율↓.
- L6: `COPY src ./src` — 컨테이너 cache 분리를 위해 deps 설치 이후 코드 복사. 패턴은 정확.
- L7: `npm run build` → `nest build` → `dist/`.
- L9–11: runtime stage. `NODE_ENV=production`이 ENV 차원에서만 설정. (`@nestjs/config`는 .env 파일을 자동 로드하지 않도록 옵션 미설정 → process.env 직접 사용.)
- L12–14: 빌더에서 `node_modules`+`dist`+`package.json`만 복사. native deps도 함께 옮겨오는 것이므로 동일 base(alpine)/동일 abi 필요(현재 동일).
- L15: `/app/var` 생성. README와 `Runtime.sqlitePath` 기본값(`./var/admin.db`)에 매칭.
- L16: 8084 expose — `Runtime.port`(`ADMIN_PORT`) 기본값과 일치.
- L17: shell-form 아닌 exec-form CMD. signal forwarding 정상(SIGTERM → node).

**짚어볼 점** (CRITICAL for Admin)
- Hardcoded secrets: 컨테이너 내 `.env` 복사 없음. `JWT_SECRET`, `ADMIN_BOOTSTRAP_PASSWORD` 등은 런타임에 inject. (정상)
- USER 지시자 없음 → root로 실행. SQLite write가 root 소유라 운영 환경에서 호스트 볼륨 마운트 시 권한 문제 위험. **권고**: `USER node` 또는 비root uid 추가.
- HEALTHCHECK 미설정. `/admin/health`가 있으니 `HEALTHCHECK CMD wget -qO- http://localhost:8084/admin/health` 추가 가능.
- builder에 dev/build 의존 그대로 → image 크기는 multistage로 어느 정도 분리되어 정상.
- `dist`만 복사하지 `tsconfig`는 미포함 → runtime에서 ts-node 로드 시도 없음(확인됨).
- `.dockerignore` 별도 존재 — 검토 권장(`node_modules`, `.env*`, `.review/` 등 누락 시 빌드 캐시 무효화).

**파일 수준 평가**
- **강점**: 2-stage + native deps 분리(빌드 deps가 runtime 이미지에 누설되지 않음); exec-form CMD; 경로 단순.
- **위험**: lockfile 부재로 비결정적 빌드; root user; HEALTHCHECK 부재; SQLite `var/` 경로 owner 미설정.
- **개선 권고**: 
  1. `npm ci` + lockfile 도입(또는 `pnpm-lock.yaml`).
  2. `USER node` + `chown -R node:node /app/var`.
  3. `HEALTHCHECK --interval=30s --timeout=3s CMD ...` 추가.
- **재읽기 권고 레벨**: Level 1 (구조 단순). 단, runtime user/HEALTHCHECK 패치 시 Level 2 재검토.
