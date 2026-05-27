# src/audit/audit.interceptor.ts — 코드 리뷰
> 리뷰 레벨: 2
> [← audit_Abstract.md](audit_Abstract.md) · [← INDEX.md](../../INDEX.md)

**파일 요약**
- 역할: APP_INTERCEPTOR로 모든 mutating(POST/PUT/DELETE) 요청을 `admin_audit_log` 테이블에 기록.
- 진입점 거리: 0 (모든 라우트 cross-cut)
- LOC: 53
- export: `AuditInterceptor`
- 의존 모듈: `AuditService`, `AuthedUser`
- 외부 패키지: `rxjs`(tap), `@nestjs/common`
- 부수효과: DB write(insertAuditLog), 비동기 — response.next 후 fire-and-forget
- 동시성: 각 request 인스턴스. AuditService→DbService는 동기/비동기 driver-dependent
- 테스트 커버리지: 0

```ts path=src/audit/audit.interceptor.ts lines=1-53
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import { AuthedUser } from '../auth/jwt.guard';

/**
 * Records every mutating Admin API call as an audit event. Read-only verbs
 * (GET, HEAD, OPTIONS) are skipped. Auth endpoints emit their own
 * login_history rows separately.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const skip = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const path = req.originalUrl as string;
    // Don't double-record login attempts here — auth.service writes login_history.
    const isAuthPath = path.startsWith('/admin/auth/');
    return next.handle().pipe(
      tap({
        next: async () => {
          if (skip || isAuthPath) return;
          const user = (req.user ?? {}) as AuthedUser;
          await this.audit.record({
            actorId: user?.sub ?? null,
            actorEmail: user?.email ?? null,
            action: `${req.method.toLowerCase()} ${path}`,
            targetType: 'http',
            targetId: path,
            payload: this.safeBody(req.body),
            ip: this.clientIp(req),
            userAgent: req.headers?.['user-agent'] ?? null,
          });
        },
      }),
    );
  }

  private safeBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return undefined;
    // Strip secrets.
    const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const k of ['password', 'newPassword', 'currentPassword', 'totp']) delete clone[k];
    return clone;
  }

  private clientIp(req: any): string | null {
    const xff = (req.headers?.['x-forwarded-for'] as string) ?? '';
    return xff.split(',')[0]?.trim() || req.ip || null;
  }
}
```

**분석 / Analysis (Level 2)**
- L15 `intercept(ctx,next)` returns Observable. NestJS standard.
- L16 `ctx.switchToHttp().getRequest()` — http context. RPC/ws에서 깨질 위험은 없음(HTTP only 서비스).
- L17 `['GET','HEAD','OPTIONS'].includes(req.method)` — method 대소문자: Express는 항상 uppercase. 안전.
- L18 `req.originalUrl` — 글로벌 prefix(`/admin`) 포함. `req.url`은 controller 라우터 내부 path라 다름. 의도 정확.
- L20 `path.startsWith('/admin/auth/')` — main.ts `setGlobalPrefix('/admin')` 와 결합. prefix 바뀌면 silently break. 권고: `Runtime.globalPrefix` 같은 상수 도입.
- L21–37 `tap({ next: async () => {...} })` 의 핵심 트랩:
  - **async function의 반환 Promise를 tap이 await 하지 않는다.** `tap`은 sync 콜백 모델로 다음 emission을 보낼 뿐, async 콜백의 결과 Promise는 unhandled. 즉, DB insert가 실패(reject)하면 unhandled rejection → process.unhandledRejection 핸들러(없음)에서 throw 가능. Node 20 default는 `--unhandled-rejections=throw` → 프로세스 죽음 위험.
  - 또한 response가 이미 전송된 후 audit 실패 시 client는 200을 받지만 audit row가 없다(silent loss).
  - 권고: `try/catch` 안에서 `await ...` 후 자체 catch(`this.log.warn(...)`).
- L23 `if (skip || isAuthPath) return;` — short circuit. 정상.
- L24 `(req.user ?? {}) as AuthedUser` — 빈 객체를 AuthedUser로 단언. user 없는 케이스(`@Public` 라우트)에서 sub/email이 undefined → null 폴백.
- L26–34 record payload 구성:
  - L29 action = `'post /admin/rules'` 형식. 일관된 형식이지만 path에 변수(`:ruleId`)가 그대로 들어가서 audit query 시 grouping이 어려움. 예: `DELETE /admin/rules/PRIV_KR_999` ↔ raw routing pattern으로 정규화하면 더 분석하기 쉬움.
  - L30 targetType: 'http' 고정. 도메인별 분류 부족.
  - L31 targetId = path (rule_id 등 의미 단위 추출이면 좋음).
  - L32 payload = safeBody(req.body). 파일 업로드(`POST /admin/rules/import-csv`)는 body 가 multipart, multer parsed body는 빈 객체이고 file은 별도 → payload는 `{}`. 어떤 파일이었는지 흔적 없음. **권고**: file size/name 기록.
- L41–46 `safeBody`:
  - L42 `if (!body || typeof body !== 'object') return undefined;` — array body는 object로 분류되어 spread 시 `{ '0': ..., '1': ... }` 으로 바뀜. RulesController는 array body를 받지 않으므로 영향 없음.
  - L44 shallow spread. 중첩 객체 안의 `password`는 strip 안 됨. 예: `{ user: { password: 'p' } }` 누설.
  - L45 strip 키 4종만. `secret`, `token`, `apiKey`, `authorization`, `totp_secret` 등 누설 위험. 또한 `enableTotp`의 `totp` 키는 strip되지만 register response의 secret은 body가 아닌 응답이므로 그대로 audit response 본문 미기록(정상).
- L49–52 `clientIp`:
  - L50 `req.headers?.['x-forwarded-for']` — 프록시 신뢰 정책 없이 헤더를 그대로 신뢰. `app.set('trust proxy', …)` 미설정 시 client가 위조 가능. main.ts에서 trust proxy 설정 부재 확인. **IP 위조 위험**.
  - L51 `xff.split(',')[0]?.trim() || req.ip` — XFF가 빈 문자열이면 `''.split(',')[0] = ''`, `''.trim() = ''`, falsy → `req.ip` 사용(정상).

**짚어볼 점** (CRITICAL for Admin)
- **Audit payload 비밀 누출**: shallow strip + 4키만. `secret`, `token`, `apiKey` 등 화이트리스트 방식이 더 안전.
- **Async tap unhandled rejection** → 프로세스 다운 위험.
- **trust proxy 미설정**으로 IP 위조 가능 → 감사 로그/login_history 신뢰성 손상.
- **GET 미감사** → read 권한 남용 추적 불가.
- **path matching이 string startsWith** → global prefix 변경 시 silently break.
- 멀티파트 업로드 payload 정보 손실(file metadata).
- `req.body` 가 큰 객체(예: BulkUpsert 10,000 rules)일 때 audit payload에 통째로 저장 → DB 크기 폭증. **권고**: 일정 크기 초과 시 truncate or hash.

**파일 수준 평가**
- **강점**: cross-cut audit 명확; secret 키 1차 마스킹; XFF 폴백 처리.
- **위험**: shallow secret strip; async 실패 silent/process kill; trust proxy 부재; bulk payload 통째 저장.
- **개선 권고**:
  1. async 실행을 `tap` 외부로 분리하거나 `tap` 내에 try/catch + `this.log.warn`.
  2. secret strip을 deep + 패턴 기반(`/secret|token|key|password|totp/i`).
  3. main.ts에서 `app.set('trust proxy', Runtime.trustProxyHops)` 추가 + interceptor는 `req.ip` 단일 소스 사용.
  4. body 크기 cap(예: 8KB 초과 시 `payload: { truncated: true, sha256: '...' }`).
- **재읽기 권고 레벨**: Level 2 (보안 cross-cut, payload 마스킹 정책 결합).
