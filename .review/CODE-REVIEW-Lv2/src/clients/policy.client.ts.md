# src/clients/policy.client.ts — 코드 리뷰
> 리뷰 레벨: 2
> [← clients_Abstract.md](clients_Abstract.md) · [← INDEX.md](../../INDEX.md)

**파일 요약**
- 역할: Policy Engine 캐시 무효화 호출. 모든 rule write 후 1회 호출.
- 진입점 거리: 2 (RulesService → PolicyClient)
- LOC: 21
- export: `PolicyClient`
- 의존 모듈: `Runtime`
- 외부 패키지: `axios`
- 부수효과: HTTP POST → 외부 서비스
- 동시성: 호출당 axios instance 재사용
- 테스트 커버리지: 0

```ts path=src/clients/policy.client.ts lines=1-21
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { Runtime } from '../config/runtime';

@Injectable()
export class PolicyClient {
  private readonly log = new Logger(PolicyClient.name);
  private readonly http: AxiosInstance = axios.create({
    baseURL: Runtime.policyEngineUrl,
    timeout: 3000,
  });

  async invalidate(): Promise<void> {
    try {
      await this.http.post('/policies/invalidate', {});
    } catch (e) {
      // Cache invalidation must not block the admin flow; log and continue.
      this.log.warn(`policy.invalidate failed: ${(e as Error).message}`);
    }
  }
}
```

**분석 / Analysis (Level 2)**
- L7 logger 인스턴스.
- L8–11 `axios.create({baseURL, timeout: 3000})`:
  - `baseURL`은 `Runtime.policyEngineUrl` (module import time 캡처). 환경 변경 시 재시작 필요.
  - `timeout: 3000ms` — 3초 후 abort. 합리적이지만 burst write 시 rule write success → invalidate 3초 hang → 사용자 latency ↑. write별 동기 invalidate(현재) 보다는 debounce/coalesce 권고.
  - **인증 헤더 없음** — Policy Engine이 외부 노출되면 누구나 cache flush 가능. 내부망 가정.
  - **TLS 미강제** — `http://`만 지원하는 default URL.
- L13–20 `invalidate()`:
  - L15 POST with empty body `{}`. Policy Engine 측 endpoint가 body를 무시하면 OK.
  - L17 catch all — error 객체 cast로 message 추출. `e`가 axios error면 `e.response?.status` 등 풍부한 정보가 있는데 사용 안 함.
  - **모든 에러 swallow** — admin flow는 보호되지만 cache stale 가능성을 사용자가 알 수 없음. metric/alert 부재.

**짚어볼 점** (CRITICAL for Admin)
- **인증 헤더 부재**: Policy Engine `/policies/invalidate` 가 internal-only인지 확인 필요. Service mesh(mTLS) 또는 shared secret 권고.
- **No retry**: 일시적 네트워크 오류 시 cache stale. exponential backoff 1-2회 + 영구 실패만 warn 권고.
- **No metrics**: 실패율 추적 불가.
- **HTTP 평문**: `Runtime.policyEngineUrl` default `http://localhost:8082`. prod에서 별도 보호 가정.
- **HEAD/timeout 외 cancel signal 없음** — axios가 자체 cancel.
- **모든 write 후 즉시 호출** — bulk upsert 10k 레코드 시에도 1번만 호출(현재 코드: RulesService.bulkUpsert 끝에서 1회). 정상.
- **HTTP keep-alive 미설정** → 매 요청 새 connection. axios default agent. high frequency invalidate 시 latency.

**파일 수준 평가**
- **강점**: timeout 3s 명확; 에러를 swallow하여 admin flow 비영향.
- **위험**: 인증 부재; retry 없음; metrics 없음.
- **개선 권고**:
  1. `Authorization: Bearer ${Runtime.policyServiceToken}` 등 shared secret.
  2. `axios-retry` 또는 자체 1회 retry.
  3. counter metric(`policy_invalidate_total{result}`).
  4. `keepAlive: true` http agent.
- **재읽기 권고 레벨**: Level 1 (단순). 외부 노출 환경에 두면 Level 2.
