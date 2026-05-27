# `src/auth/` — Directory Abstract

인증·인가의 모든 책임 (DTO, Guard, Public decorator, Controller, Service, Module).

- `auth.module.ts` — `@Global()` + JwtModule.register + APP_GUARD 등록.
- `auth.controller.ts` — `/auth/register`, `/auth/login`(both `@Public`), `/auth/me`, `/auth/totp/qr`, `/auth/totp/enable`, `/auth/password`.
- `auth.service.ts` — bcrypt + otplib + qrcode + JwtService.signAsync. **부트스트랩 super_admin 생성** 책임도 보유 (OnModuleInit).
- `dto.ts` — Register/Login/EnableTotp/ChangePassword DTOs (`class-validator`).
- `jwt.guard.ts` — Bearer 토큰 검증, `@Public()` skip.
- `public.decorator.ts` — `SetMetadata(PUBLIC_KEY,true)`.

## 핵심 위험 (Critical/High)

| # | 위치 | 요지 |
| :-- | :-- | :-- |
| 1 | `auth.controller.ts:20-24` | **/auth/register이 `@Public()`** → 누구나 admin 계정 self-register 가능. role도 클라이언트 지정 가능. |
| 2 | `auth.service.ts:24-27` | bootstrap에서 TOTP secret을 generate하고 DB에 평문 저장 (DbService 컬럼 그대로). |
| 3 | `auth.service.ts:36-46` | register 응답이 평문 TOTP secret + QR data URL을 그대로 반환. |
| 4 | `auth.module.ts:13` | JwtModule.register secret을 `Runtime.jwtSecret`에서 즉시 캡처. `'change-me-in-prod'` fallback. |
| 5 | `auth.service.ts:71-119` (login) | rate limit 없음 → brute force. `bad_password` vs `no_such_user`의 응답 시간차로 user enumeration. |
| 6 | `auth.controller.ts:8-13` (clientCtx) | `x-forwarded-for` 첫 항목을 신뢰. 신뢰 가능한 프록시 검증 없음 → spoofing 가능. |

## 강점
- Public 데코레이터로 화이트리스트 명시.
- 로그인 실패 케이스마다 `admin_login_history`에 reason 기록.
- bcrypt + TOTP 결합 2FA.
- DTO 검증 (email, min length).
