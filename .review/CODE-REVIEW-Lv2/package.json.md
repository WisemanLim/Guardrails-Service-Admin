# package.json — 코드 리뷰
> 리뷰 레벨: 2
> [← INDEX.md](.review/CODE-REVIEW-Lv2/INDEX.md)

**파일 요약**
- 역할: npm 매니페스트. deps/scripts/jest 설정.
- 진입점 거리: 빌드/런타임 모두 통과
- LOC: 61
- export: name=`guardrails-admin`, version=`0.1.0`
- 의존 모듈: nest 10 + ts 5.4 + pg/better-sqlite3 듀얼
- 외부 패키지: 위 표 + bcryptjs/otplib/qrcode/papaparse
- 부수효과: scripts 실행 시 자식 프로세스
- 동시성: N/A
- 테스트 커버리지: jest config 포함

```json path=package.json lines=1-61
{
  "name": "guardrails-admin",
  "version": "0.1.0",
  "description": "Admin API for the MCP Guardrails Service — auth (email/pw + TOTP), audit, and per-domain rule CRUD.",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main.js",
    "lint": "eslint \"src/**/*.ts\"",
    "test": "jest"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/config": "^3.2.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/platform-express": "^10.3.0",
    "axios": "^1.6.8",
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^11.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "multer": "^1.4.5-lts.1",
    "otplib": "^12.0.1",
    "papaparse": "^5.4.1",
    "pg": "^8.11.5",
    "qrcode": "^1.5.3",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.1",
    "zod": "^3.22.4"
  }
}
```

**분석 / Analysis (Level 2)**
- `private: true` — npm 퍼블리시 차단(정상, 내부 서비스).
- `scripts.lint`: `eslint "src/**/*.ts"` — `.eslintrc(.json|.js|.cjs)` 또는 `eslint.config.js` **없음**. 명령 실행 시 즉시 실패할 가능성. dead script.
- `scripts.test`: `jest` 직접 호출. jest config는 본 파일의 `jest` 키에 인라인. `rootDir: src` + `testRegex: .*\.spec\.ts$` — `tsconfig.json`이 `**/*.spec.ts` 를 exclude하지만 ts-jest는 자체 transform이라 무관.
- deps:
  - **`zod@^3.22.4`** — 코드 import 없음. **dead dep** (제거 후보).
  - `@nestjs/config@^3.2.0` — forRoot만 호출되고 ConfigService 미사용. Runtime이 process.env 직접 사용 → 사실상 dead dep에 가까움.
  - `class-transformer@^0.5.1` — `rules/dto.ts`의 `@Type(() => RuleDto)`에 사용. 필요.
  - `multer@^1.4.5-lts.1` — `1.x lts`. `@nestjs/platform-express` peer로 충분히 동작하지만 `@types/multer` 매칭 확인 필요.
  - `bcryptjs@^2.4.3` — pure-JS. native `bcrypt`보다 느리지만 native build 불필요. (rounds=10 기준 ~100ms/hash, 적당).
  - `pg`/`better-sqlite3` 양쪽 deps 동시 보유 → driver env에 따라 동적 import. 어떤 driver든 컨테이너 빌드 시 모두 install되어 image 크기 ↑.
- devDeps:
  - `supertest@^6.3.4` — **사용 없음**. 통합 테스트 미작성. dead dep.
  - `@nestjs/testing@^10.3.0` — 사용 없음. dead dep.
  - typescript 5.4 + ts-node 10.9 + jest 29 — 표준.
- caret(`^`) 모든 deps + lockfile 부재 → patch/minor floating. 재현성 위험.

**짚어볼 점**
- ESLint 설정 부재인 채로 `lint` script만 노출. CI에서 호출되면 실패.
- `zod`/`supertest`/`@nestjs/testing` 미사용 패키지 — dependency footprint 증가.
- `private: true`이지만 lockfile 부재 → supply chain 공격 surface 큼(`npm install`마다 새 transitive 가능).
- `engines` 필드 부재 → Node 버전 강제 안 됨(Dockerfile은 20.x이지만 dev 환경은 자유).
- `bcryptjs` 선택 시 verify 시간 ~100ms (rounds=10) — login 평균 latency에 직결.

**파일 수준 평가**
- **강점**: 명확한 scripts; jest 인라인 설정 단순.
- **위험**: dead deps 3개; lockfile 부재; lint config 부재; engines 미지정.
- **개선 권고**:
  1. `zod`/`supertest`/`@nestjs/testing` 제거 또는 실제 사용 추가(Runtime 검증/통합 테스트).
  2. `package-lock.json` 커밋.
  3. `engines: { node: ">=20.0.0" }` 추가.
- **재읽기 권고 레벨**: Level 1.
