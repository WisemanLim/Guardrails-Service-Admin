# `src/auth/dto.ts`

## Header
- 역할 / Role: 인증 관련 DTO 정의 (class-validator 데코레이터). RegisterDto, LoginDto, EnableTotpDto, ChangePasswordDto.
- 진입점에서의 거리: 2 (controller → DTO)
- 라인 수: 41
- 주요 export: 4 클래스
- 의존 모듈: 없음
- 사용된 외부 패키지: `class-validator` (IsEmail, IsOptional, IsString, MinLength)
- 부수효과: import-time 데코레이터 등록.
- 동시성 모델: N/A
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

```ts path=src/auth/dto.ts lines=1-41
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  role?: 'admin' | 'super_admin' | 'viewer';
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  totp?: string;
}

export class EnableTotpDto {
  @IsString()
  totp!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
```

**분석 / Analysis (Level 2)**
- `RegisterDto.role`은 TypeScript에선 literal union이지만 **`@IsString()`만 적용** → 런타임 검증은 string 여부만. 임의 문자열이 통과해 DB 레벨 CHECK 위반으로 500이 날 가능성 (또는 valid 'super_admin'으로 권한 escalation). **`@IsIn(['admin','super_admin','viewer'])` 누락**.
- `password` 최소 8자 — 약함. 영문/숫자/특수문자 혼합 검사 없음. NIST 800-63B는 길이 우선이지만 사전 비교가 권장됨. 약한 패스워드 사전(common-passwords) 검사 부재.
- `LoginDto.totp` `@IsOptional() @IsString()` — 6 digit 강제 없음. 임의 문자열 통과. AuthenticatorCheck 시 거부되지만 입력 검증 일찍 처리하는 게 더 안전.
- `EnableTotpDto.totp`는 required. 단, 6자리 정규식 미적용. `@Matches(/^\d{6}$/)` 권고.
- `ChangePasswordDto.newPassword`도 MinLength(8). 새 ≠ 현재 검증 부재 — 같은 패스워드로 변경 가능.
- 모든 DTO가 `!`로 strict-null 회피. `whitelist: true`가 글로벌이라 unknown 키는 제거됨.

**짚어볼 점**
- `role` enum 검증 부재 (Critical).
- TOTP 6-digit 검증 부재.
- password 약함 (사전 비교 없음).
- newPassword !== currentPassword 검증 부재.

## File-level Verdict
- 강점: 최소한의 DTO 컨벤션 준수.
- 위험: role enum 미검증.
- 개선 권고: `@IsIn`/`@Matches`/`@MinLength(12)`/Password policy 외부 라이브러리.
- 재읽기 권고 레벨: Medium — DTO 변경마다 controller/service 동기화 점검.
