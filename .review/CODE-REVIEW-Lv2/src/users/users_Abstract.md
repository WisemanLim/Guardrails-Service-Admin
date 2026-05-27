# `src/users/` — Directory Abstract

가장 가벼운 feature 모듈. `UsersModule`은 `UsersController`만 포함, `DbService`는 글로벌이므로 imports 없이 주입.

- `users.controller.ts` — `GET /admin/users`, **super_admin 전용** 가드. DbService.listUsers() 결과를 그대로 반환.
- `users.module.ts` — 한 줄 모듈 선언.

## 한계
- 사용자 비활성화/삭제 API 없음 (`status`는 'active|disabled'이지만 변경 엔드포인트 없음).
- 역할 변경, 다른 사용자 비밀번호 리셋, TOTP 재발급 API 없음.
- listUsers는 200 limit hard-coded, 페이지네이션 없음.
