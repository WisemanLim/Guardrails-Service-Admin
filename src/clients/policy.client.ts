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
