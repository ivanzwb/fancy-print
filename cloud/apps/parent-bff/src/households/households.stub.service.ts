import { BadRequestException, Injectable } from '@nestjs/common';

/** In-memory idempotency for doc/4 §2.4.2 bind / approve / reject (stub). */
@Injectable()
export class HouseholdsStubService {
  private readonly bindByKey = new Map<string, Record<string, unknown>>();
  private readonly approveByKey = new Map<string, Record<string, unknown>>();
  private readonly rejectByKey = new Map<string, Record<string, unknown>>();

  bind(
    householdId: string,
    idempotencyKey: string | undefined,
    _body: { bind_code?: string },
  ) {
    const key = this.requireKey('bind', householdId, '', idempotencyKey);
    const hit = this.bindByKey.get(key);
    if (hit) return { ...hit };
    const out = {
      household_id: householdId,
      device_id: 'fancy-print-dev',
      status: 'bound',
    };
    this.bindByKey.set(key, out);
    return { ...out };
  }

  approve(householdId: string, jobId: string, idempotencyKey: string | undefined) {
    const key = this.requireKey('approve', householdId, jobId, idempotencyKey);
    const hit = this.approveByKey.get(key);
    if (hit) return { ...hit };
    const out = {
      household_id: householdId,
      job_id: jobId,
      status: 'approved',
    };
    this.approveByKey.set(key, out);
    return { ...out };
  }

  reject(householdId: string, jobId: string, idempotencyKey: string | undefined) {
    const key = this.requireKey('reject', householdId, jobId, idempotencyKey);
    const hit = this.rejectByKey.get(key);
    if (hit) return { ...hit };
    const out = {
      household_id: householdId,
      job_id: jobId,
      status: 'rejected',
    };
    this.rejectByKey.set(key, out);
    return { ...out };
  }

  private requireKey(
    op: string,
    householdId: string,
    jobId: string,
    idempotencyKey: string | undefined,
  ): string {
    const raw = idempotencyKey?.trim();
    if (!raw) {
      throw new BadRequestException({
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: `Idempotency-Key header is required for ${op}`,
      });
    }
    return `${op}:${householdId}:${jobId}:${raw}`;
  }
}
