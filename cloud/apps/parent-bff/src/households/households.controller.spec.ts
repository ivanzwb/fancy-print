import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';
import type { ParentPrincipal } from '../common/current-parent.decorator';

const mockParent = (overrides?: Partial<ParentPrincipal>): ParentPrincipal => ({
  sub: 'parent:test@test.com',
  email: 'test@test.com',
  household_id: 'hh-test-1',
  ...overrides,
});

describe('HouseholdsController', () => {
  let controller: HouseholdsController;
  let service: HouseholdsService;
  let parent: ParentPrincipal;

  beforeEach(async () => {
    parent = mockParent();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HouseholdsController],
      providers: [HouseholdsService],
    }).compile();

    controller = module.get(HouseholdsController);
    service = module.get(HouseholdsService);
  });

  describe('devices', () => {
    it('returns devices for the parent household', async () => {
      await service.bindDevice('hh-test-1', 'd1', 'ik-1');
      await service.bindDevice('hh-test-1', 'd2', 'ik-2');

      const result = await controller.devices('hh-test-1', parent);
      expect(result.household_id).toBe('hh-test-1');
      expect(result.devices).toHaveLength(2);
    });

    it('throws ForbiddenException for mismatched household', async () => {
      await expect(
        controller.devices('hh-other', parent),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('bind', () => {
    it('binds a device', async () => {
      const result = await controller.bind(
        'hh-test-1',
        parent,
        'ik-bind',
        { bind_code: 'device-abc' },
      );
      expect(result.status).toBe('bound');
    });

    it('throws ForbiddenException for mismatched household on bind', async () => {
      await expect(
        controller.bind('hh-other', parent, 'ik-bind-2', {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('unbind', () => {
    it('unbinds a device', async () => {
      await service.bindDevice('hh-test-1', 'd1', 'ik-u');
      const result = await controller.unbind('hh-test-1', 'd1', parent);
      expect(result).toMatchObject({ status: 'unbound', device_id: 'd1' });
      const devices = await service.getDevices('hh-test-1');
      expect(devices).toHaveLength(0);
    });

    it('throws ForbiddenException for mismatched household', async () => {
      await expect(
        controller.unbind('hh-other', 'd1', parent),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getPolicy / patchPolicy', () => {
    it('returns default policy', async () => {
      const result = await controller.getPolicy('hh-test-1', parent);
      expect(result.household_id).toBe('hh-test-1');
      expect(result.version).toBe(1);
    });

    it('patches policy', async () => {
      const result = await controller.patchPolicy(
        'hh-test-1', parent,
        { remote_print_gate: true },
      );
      expect(result.remote_print_gate).toBe(true);
    });
  });

  describe('jobs', () => {
    it('returns pending approvals', async () => {
      await service.approve('hh-test-1', 'j1', 'ik-ca1');
      const result = await controller.pendingApprovals('hh-test-1', parent);
      expect(result.household_id).toBe('hh-test-1');
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it('lists jobs', async () => {
      await service.recordJob('hh-test-1', {
        job_id: 'j-list-1',
        device_id: 'd1',
        content_mode: 'coloring_quiet_book',
        state: 'created',
        created_at: new Date().toISOString(),
      });
      const result = await controller.jobs('hh-test-1', parent);
      expect(result.items).toHaveLength(1);
    });
  });

  describe('approve / reject', () => {
    it('approves a job', async () => {
      const result = await controller.approve(
        'hh-test-1', 'j-approve', parent, 'ik-ap', { device_id: 'd1' },
      );
      expect(result.status).toBe('approved');
    });

    it('rejects a job', async () => {
      const result = await controller.reject(
        'hh-test-1', 'j-reject', parent, 'ik-rj', { device_id: 'd1' },
      );
      expect(result.status).toBe('rejected');
    });
  });
});
