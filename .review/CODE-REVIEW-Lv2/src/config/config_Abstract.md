# `src/config/` — Directory Abstract

단 한 파일 `runtime.ts`. 정적 `Runtime` 객체로 모든 env 값을 import-time에 캡처. `@nestjs/config`의 ConfigService는 미사용. 결과적으로:

- 테스트에서 env 동적 변경이 어려움 (모듈 cache 재로드 필요).
- 누락 시 fallback이 hardcoded — JWT_SECRET이 default `'change-me-in-prod'`로 떨어져 prod 사고 가능.
- DB_DRIVER 정규화 ('sqlite' | 'postgres')만 수행, 다른 값은 'postgres'로 강제.
