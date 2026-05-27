# nest-cli.json — 코드 리뷰
> 리뷰 레벨: 2
> [← INDEX.md](.review/CODE-REVIEW-Lv2/INDEX.md)

**파일 요약**
- 역할: NestJS CLI 빌드 설정. `nest build` 가 사용.
- 진입점 거리: 빌드 도구
- LOC: 6
- export: —
- 의존 모듈: `@nestjs/schematics`, `@nestjs/cli`
- 외부 패키지: tsc(nest build wrapper)
- 부수효과: 빌드 시 `dist/` 삭제
- 동시성: N/A
- 테스트 커버리지: 없음

```json path=nest-cli.json lines=1-6
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

**분석 / Analysis (Level 2)**
- L2: `$schema` — IDE/JSON Schema validator 힌트. 안전.
- L3: schematics collection 명시.
- L4: `sourceRoot: src` — 컴파일 입력 루트. `tsconfig.json`의 `include: ["src/**/*"]`와 일치.
- L5: `deleteOutDir: true` — 빌드 전 `dist/` 정리. 부분 빌드 캐시 결함을 방지.

**짚어볼 점**
- assets 옵션 미설정 → 정적 파일(예: `schema.sql`, 이메일 템플릿 등) 복사가 필요해질 경우 누락. 현재 모든 자원은 ts source에 인라인이라 문제 없음.
- `webpack`/`watchAssets` 미설정 → 표준 tsc.
- 환경별 빌드(prod/dev) 분기 없음 — 단순.

**파일 수준 평가**
- **강점**: 미니멀 + 표준.
- **위험**: 없음.
- **개선 권고**: 정적 자원이 늘면 `compilerOptions.assets` 추가 고려.
- **재읽기 권고 레벨**: Level 1.
