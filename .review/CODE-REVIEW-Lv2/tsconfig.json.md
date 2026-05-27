# tsconfig.json — 코드 리뷰
> 리뷰 레벨: 2
> [← INDEX.md](.review/CODE-REVIEW-Lv2/INDEX.md)

**파일 요약**
- 역할: TypeScript 컴파일러 옵션.
- LOC: 20
- 부수효과: 빌드 산출물 `./dist`
- 테스트 커버리지: —

```json path=tsconfig.json lines=1-20
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

**분석 / Analysis (Level 2)**
- `module: commonjs` + `target: ES2022` — Node 20 표준. `top-level await` 등 ESM 기능 미사용이므로 cjs 적절.
- `lib: ["ES2022"]` — DOM 제외. 서버 only 이미지 맞음. 단, `"DOM"` 미포함이라 `URL`/`URLSearchParams`가 lib 'ES2022'에 포함되어 있는지 의존(included). 안전.
- `experimentalDecorators` + `emitDecoratorMetadata` — NestJS DI 필수. 정상.
- `strict: true` — `noImplicitAny`, `strictNullChecks` 모두 on. 단, `any` 캐스팅은 코드 곳곳에 존재(예: `db.service.ts`의 `(r: any) => ...`, `audit.interceptor.ts`의 `req: any`).
- `resolveJsonModule: true` — JSON import 가능(현재 사용 없음).
- `skipLibCheck: true` — third-party 타입 충돌 우회. 빠르지만 잘못된 deps 타입을 놓칠 위험.
- `incremental: true` + sourceMap — dev 편의. 단, prod docker image에 `.tsbuildinfo`는 안 들어감(`dist/`만 copy).
- `exclude: ["**/*.spec.ts"]` — production 컴파일에서 테스트 제외. `nest build`/`tsc` 모두 따름. ts-jest는 별도 transform이라 무관.

**짚어볼 점**
- `strict: true`임에도 `any` 사용처가 다수(`db.service.ts`에 `// eslint-disable-next-line @typescript-eslint/no-explicit-any`). 듀얼 드라이버 추상 부재로 인한 부득이한 우회.
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch` 등 강화 옵션 미설정 → 잠재 인덱스 undefined 오류 감지 안 됨(예: `xff.split(',')[0]?.trim()`은 optional chain 덕에 안전).
- `paths`/`baseUrl` 매핑 미설정 → alias import 없음(예: `@db/*`). 현재는 짧은 경로라 무문제.
- `outDir`만 지정, `rootDir` 미지정 — `src` 자동 추론. 안전.

**파일 수준 평가**
- **강점**: strict + decorators 메타 + 표준 Node target.
- **위험**: any 우회 누적; 강화 옵션 미사용.
- **개선 권고**:
  1. `noUncheckedIndexedAccess: true` 추가 검토(`xff.split(',')[0]` 같은 사례 추적 강화).
  2. `tsc --noEmit` CI gate(현재 `lint` script 깨진 상태이므로 대체).
- **재읽기 권고 레벨**: Level 1.
