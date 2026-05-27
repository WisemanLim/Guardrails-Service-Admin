# `src/main.ts` — Bootstrap Entrypoint

## Header
- 역할 / Role: NestFactory로 HTTP 서버를 부트스트랩하고 CORS·prefix·ValidationPipe·shutdown hook을 설정. `0.0.0.0:${PORT}` 바인딩.
- 진입점에서의 거리: **0 (진입점 자체)**
- 라인 수: 41
- 주요 export: `bootstrap` (file scope, 자동 호출)
- 의존 모듈 (internal): `./app.module` (AppModule)
- 사용된 외부 패키지: `@nestjs/core` (NestFactory), `@nestjs/common` (Logger, ValidationPipe)
- 부수효과: HTTP listener 시작; process.env 읽기 (`ADMIN_CORS_ORIGINS`, `PORT`); shutdown hook 등록; 로그 출력
- 동시성 모델: 단일 Node event loop, Express 핸들러 콜백 기반. `await app.listen()` 후 프로세스가 유지
- 테스트 커버리지 흔적: 없음

## Line-by-Line Review (Level 2)

```ts path=src/main.ts lines=1-13
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

function parseOrigins(): string[] | true {
  const raw = (process.env.ADMIN_CORS_ORIGINS ?? '').trim();
  if (raw === '*') return true as unknown as string[];
  if (!raw) {
    // Sensible defaults: Admin Web dev (3001) + standalone preview (3000).
    return ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://localhost:3000'];
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
```

**분석 / Analysis (Level 2)**
- L1–3: Nest 부트스트랩 + AppModule import. `Logger`는 동기 console wrapper로 부수효과 없음.
- L5: `parseOrigins()` 반환 시그니처가 `string[] | true`. 실제로 `true`를 `unknown as string[]`로 캐스팅(L7)하여 컴파일러를 속이지만 호출부(L23–25)는 `origins === true`로 다시 분기. 시그니처를 `string[] | boolean`으로 표현하는 게 정확. 흔한 실수: union을 거짓 캐스팅으로 호도하면 lib 업그레이드 시 깨지기 쉽다.
- L6: `process.env.ADMIN_CORS_ORIGINS ?? ''` — `??`는 null/undefined만 처리. 빈 문자열은 그대로. `.trim()`으로 공백 정리.
- L7: `raw === '*'` → 모든 origin reflect. `as unknown as string[]`은 ts strict 모드 통과용 더블 캐스팅이지만 호출부 의도가 깨지면 런타임에서 reflect의 영향이 크다. **CORS `*` + JWT in Authorization header는 CSRF 차단되긴 하나, 외부 origin JS가 사용자의 토큰 없이도 read-only public 엔드포인트(예: health)에 접근 가능** — 정보 누출은 최소화되지만 default를 '*'로 두지 말 것.
- L8–11: default origin 목록에 **`http://localhost:3000`** 포함. README상 Admin Web은 :3001. :3000은 dev preview 용. prod 배포 시 ADMIN_CORS_ORIGINS를 반드시 명시해야 함 — 기본값이 dev origin을 허용함을 운영팀에 명시 필요.
- L12: CSV split → trim → falsy filter. `'a, ,b'` → `['a','b']`. OK.

**짚어볼 점 / Watch-outs**
- 시그니처 정직성: `string[] | boolean`이 더 정확.
- prod 배포 사전 점검: `ADMIN_CORS_ORIGINS` 반드시 set. 부재 시 dev origin 노출.

```ts path=src/main.ts lines=15-31
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('admin');

  // CORS — required because the Admin Web (Next.js) runs on a different
  // origin than the Admin API. Override via ADMIN_CORS_ORIGINS (CSV or "*").
  const origins = parseOrigins();
  app.enableCors({
    origin: origins === true ? true : origins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
    exposedHeaders: ['Content-Type'],
    maxAge: 600,
    credentials: false,
  });
```

**분석 / Analysis (Level 2)**
- L16: `NestFactory.create(AppModule)` — Express adapter 기본. Promise 반환. 단일 await로 모든 모듈 onModuleInit(특히 AuthService bootstrap & DbService open) 직렬 실행.
- L17: `enableShutdownHooks()` — Nest의 `OnModuleDestroy`를 OS SIGTERM/SIGINT에 바인딩. `DbService.onModuleDestroy`가 PG `pool.end()` + sqlite `close()`를 호출. 누락 시 컨테이너 재시작 시 커넥션 leak.
- L18: `ValidationPipe({ whitelist: true, transform: true })` — strip unknown props + class-transformer로 string→number 변환. 단점: `transform:true`는 `@Type()` 데코레이터로 명시되지 않은 필드에 자동 형변환을 시도해 가끔 string→number 의도하지 않은 변환을 일으킬 수 있다. 본 코드는 DTO가 단순해 영향 없음.
- L19: `setGlobalPrefix('admin')` — 모든 라우트에 `/admin` prefix. 단, AuditInterceptor의 `path.startsWith('/admin/auth/')` 체크가 prefix와 결합되어 동작. prefix를 바꾸면 인터셉터 skip이 깨짐.
- L24–31: `allowedHeaders`에 **`x-admin-token`** 포함 — 코드 어디에서도 사용되지 않음 (legacy 또는 미래 대비). dead config. `credentials: false`는 쿠키/HTTP auth 비전송. JWT는 Authorization 헤더로만 송수신.
- `maxAge: 600` — preflight cache 10분.

**짚어볼 점 / Watch-outs**
- `x-admin-token` allowedHeaders는 unused.
- 만약 `*` origin + `credentials:true` 조합이 들어가면 브라우저가 거부. 현재는 `false`라 안전.
- Helmet/HSTS 등 보안 헤더 미설정.

```ts path=src/main.ts lines=33-41
  const port = Number(process.env.PORT ?? 8084);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `Admin API listening on :${port} (prefix /admin, cors=${
      origins === true ? '*' : (origins as string[]).join(',')
    })`,
  );
}
bootstrap();
```

**분석 / Analysis (Level 2)**
- L33: `Number(undefined)` → `NaN`. `??`로 fallback 후 변환이므로 NaN 회피. 단, `PORT='abc'`면 `Number('abc')=NaN`이고 `app.listen(NaN, ...)`은 OS가 임의 free 포트 할당 → 의도치 않은 동작. 입력 검증 부재. zod로 env 스키마 검증을 강력 권고.
- L34: `'0.0.0.0'` 바인딩 — 컨테이너 환경 정상. host 모드에선 외부 노출 주의.
- L35–39: 로그 한 줄이 `cors=*` 표시까지 자세히 출력. 운영상 유용.
- L41: top-level `bootstrap()` 호출. `await` 없음 → unhandled rejection 가능. 부트 실패 시 stack trace는 Node 기본 출력. 권장: `bootstrap().catch((e) => { console.error(e); process.exit(1); });`

**짚어볼 점 / Watch-outs**
- `PORT` 검증 부재 (NaN risk).
- bootstrap reject 시 에러 swallow 가능 — 컨테이너 재시작은 OK지만 로그가 빈약.
- helmet, response compression, request body size limits (Multer 외)이 전역에 부재.

## File-level Verdict

**강점 / Strengths**
- ValidationPipe `whitelist+transform` 글로벌 적용 → DTO unknown 키 차단.
- shutdown hook으로 DB 커넥션 정리.
- CORS 처리에 reasonable defaults + override 가능.

**위험 / Risks**
- `PORT` env 입력 검증 없음.
- prod에서 `ADMIN_CORS_ORIGINS` 미설정 시 dev origin 허용.
- 보안 헤더(helmet) 부재.
- `bootstrap()`의 unhandled rejection.

**개선 권고 / Recommendations**
- helmet + body size + compression 미들웨어 추가.
- `parseOrigins()` 시그니처를 `string[] | true`에서 `string[] | boolean`로.
- env 검증을 zod로 (이미 deps에 zod 존재).
- `bootstrap().catch(...)` 패턴.

**재읽기 권고 레벨 / Reread Level: Low** — 짧고 단순. 변경 사유: CORS·보안 헤더 정책 변경 시.
