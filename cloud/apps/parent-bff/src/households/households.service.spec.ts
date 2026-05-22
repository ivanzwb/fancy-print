import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { HouseholdsService } from './households.service';

describe('HouseholdsService', () => {
  let service: HouseholdsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HouseholdsService],
    }).compile();

    service = module.get(HouseholdsService);
  });

  describe('getDevices', () => {
    it('returns empty array for unknown household', async () => {
      const devices = await service.getDevices('unknown-id');
      expect(devices).toEqual([]);
    });

    it('lists devices after bind', async () => {
      await service.bindDevice('hh-1', 'device-1', 'idem-1');
      const devices = await service.getDevices('hh-1');
      expect(devices).toHaveLength(1);
      expect(devices[0].device_id).toBe('device-1');
      expect(devices[0].online).toBe(true);
      expect(devices[0].last_seen).toBeTruthy();
    });

    it('is isolated by household', async () => {
      await service.bindDevice('hh-a', 'd1', 'id-a');
      await service.bindDevice('hh-b', 'd2', 'id-b');
      expect(await service.getDevices('hh-a')).toHaveLength(1);
      expect(await service.getDevices('hh-b')).toHaveLength(1);
    });
  });

  describe('bindDevice / unbindDevice', () => {
    it('rejects missing idempotency key', async () => {
      await expect(service.bindDevice('hh-1', 'd1', undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns cached result on idempotent retry', async () => {
      const r1 = await service.bindDevice('hh-1', 'd1', 'idem-x');
      const r2 = await service.bindDevice('hh-1', 'd1', 'idem-x');
      expect(r2).toMatchObject({ status: 'bound' });
      // Should return the same shape
      expect(r2.device_id).toBe(r1.device_id);
    });

    it('unbinds device', async () => {
      await service.bindDevice('hh-1', 'd1', 'idem-u1');
      await service.unbindDevice('hh-1', 'd1');
      const devices = await service.getDevices('hh-1');
      expect(devices).toHaveLength(0);
    });
  });

  describe('getPolicy / patchPolicy', () => {
    it('returns defaults for unknown household', async () => {
      const p = await service.getPolicy('unknown');
      expect(p.version).toBe(1);
      expect(p.tier).toBe('A');
      expect(p.remote_print_gate).toBe(false);
    });

    it('patches remote_print_gate', async () => {
      const r = await service.patchPolicy('hh-p1', undefined, true);
      expect(r.remote_print_gate).toBe(true);
      expect(r.version).toBe(2);
      const p = await service.getPolicy('hh-p1');
      expect(p.remote_print_gate).toBe(true);
      expect(p.version).toBe(2);
    });

    it('rejects version conflict', async () => {
      await expect(
        service.patchPolicy('hh-p1', 999, true),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('approve / reject', () => {
    it('approves a job', async () => {
      const r = await service.approve('hh-1', 'job-1', 'idem-ap1');
      expect(r.status).toBe('approved');
      expect(r.job_id).toBe('job-1');
    });

    it('rejects a job', async () => {
      const r = await service.reject('hh-1', 'job-2', 'idem-rj1');
      expect(r.status).toBe('rejected');
    });

    it('returns idempotent result', async () => {
      const r1 = await service.approve('hh-1', 'job-3', 'idem-ap2');
      const r2 = await service.approve('hh-1', 'job-3', 'idem-ap2');
      expect(r2).toMatchObject({ status: 'approved' });
    });

    it('lists pending approvals', async () => {
      await service.approve('hh-1', 'job-a', 'idem-aa');
      await service.reject('hh-1', 'job-b', 'idem-ab');
      const approvals = await service.getPendingApprovals('hh-1');
      expect(approvals.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('recordJob / getJobs', () => {
    it('records and lists jobs', async () => {
      await service.recordJob('hh-j1', {
        job_id: 'j1',
        device_id: 'd1',
        content_mode: 'coloring_quiet_book',
        state: 'created',
        created_at: new Date().toISOString(),
      });
      const page = await service.getJobs('hh-j1');
      expect(page.items).toHaveLength(1);
      expect(page.items[0].job_id).toBe('j1');
    });

    it('supports cursor-based pagination', async () => {
      const base = Date.now();
      for (let i = 0; i < 5; i++) {
        await service.recordJob('hh-j2', {
          job_id: `job-${i}`,
          content_mode: 'coloring_quiet_book',
          state: 'created',
          created_at: new Date(base + i * 1000).toISOString(),
        });
      }
      const page1 = await service.getJobs('hh-j2', undefined, 2);
      expect(page1.items).toHaveLength(2);
      expect(page1.page.next_cursor).toBeTruthy();
    });
  });

  describe('usesRedis', () => {
    it('returns false in test environment', () => {
      expect(service.usesRedis()).toBe(false);
    });
  });
});
