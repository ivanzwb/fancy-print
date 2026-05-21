import { Test, TestingModule } from '@nestjs/testing';
import { PolicyService } from './policy.service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('PolicyService', () => {
  let service: PolicyService;
  const origEnv = process.env.POLICY_JSON_PATH;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.POLICY_JSON_PATH;
    } else {
      process.env.POLICY_JSON_PATH = origEnv;
    }
  });

  describe('default (hardcoded) policy', () => {
    beforeEach(async () => {
      delete process.env.POLICY_JSON_PATH;
      const module: TestingModule = await Test.createTestingModule({
        providers: [PolicyService],
      }).compile();
      service = module.get(PolicyService);
    });

    describe('canonicalBody', () => {
      it('should have version 1 and schema fancy-print.policy.v1', () => {
        expect(service.canonicalBody.version).toBe(1);
        expect(service.canonicalBody.schema).toBe('fancy-print.policy.v1');
      });

      it('should contain expected content_modes_allowed', () => {
        expect(service.canonicalBody.content_modes_allowed).toEqual([
          'coloring_quiet_book',
          'paper_craft',
          'dress_up',
        ]);
      });

      it('should have remote_print_gate disabled by default', () => {
        expect(service.canonicalBody.features.remote_print_gate).toBe(false);
      });
    });

    describe('maybeNotModified', () => {
      it('should return body and etag when If-None-Match does not match', () => {
        const result = service.maybeNotModified(undefined);
        expect(result.notModified).toBe(false);
        expect(result.body).toEqual(service.canonicalBody);
        expect(result.etag).toBeDefined();
        expect(result.etag).toMatch(/^"[a-f0-9]{16}"$/);
      });

      it('should return notModified=true when If-None-Match matches etag', () => {
        const { etag } = service.maybeNotModified(undefined);
        const result = service.maybeNotModified(etag);
        expect(result.notModified).toBe(true);
        expect(result.body).toBeUndefined();
        expect(result.etag).toBeUndefined();
      });

      it('should produce deterministic etag across instances', () => {
        const service2 = new PolicyService();
        const r1 = service.maybeNotModified(undefined);
        const r2 = service2.maybeNotModified(undefined);
        expect(r1.etag).toBe(r2.etag);
      });

      it('should handle empty string If-None-Match', () => {
        const result = service.maybeNotModified('');
        expect(result.notModified).toBe(false);
        expect(result.body).toBeDefined();
      });
    });
  });

  describe('configurable policy from JSON file', () => {
    let tmpFile: string;

    afterEach(() => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    });

    it('should load custom content_modes_allowed from JSON file', () => {
      tmpFile = path.join(os.tmpdir(), `policy-test-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        version: 2,
        schema: 'fancy-print.policy.v2',
        content_modes_allowed: ['custom_mode_a', 'custom_mode_b'],
        features: { remote_print_gate: true },
      }), 'utf8');
      process.env.POLICY_JSON_PATH = tmpFile;

      const svc = new PolicyService();
      expect(svc.canonicalBody.version).toBe(2);
      expect(svc.canonicalBody.content_modes_allowed).toEqual([
        'custom_mode_a', 'custom_mode_b',
      ]);
      expect(svc.canonicalBody.features.remote_print_gate).toBe(true);
    });

    it('should fallback to defaults when JSON is invalid', () => {
      tmpFile = path.join(os.tmpdir(), `policy-test-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, '{invalid json}', 'utf8');
      process.env.POLICY_JSON_PATH = tmpFile;

      const svc = new PolicyService();
      expect(svc.canonicalBody.version).toBe(1);
    });

    it('should fallback to defaults when JSON has missing fields', () => {
      tmpFile = path.join(os.tmpdir(), `policy-test-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({ version: 2 }), 'utf8');
      process.env.POLICY_JSON_PATH = tmpFile;

      const svc = new PolicyService();
      expect(svc.canonicalBody.version).toBe(1); // fallback
    });

    it('should fallback to defaults when file does not exist', () => {
      process.env.POLICY_JSON_PATH = '/nonexistent/policy.json';
      const svc = new PolicyService();
      expect(svc.canonicalBody.version).toBe(1);
    });
  });

  describe('reload', () => {
    it('should reset to defaults when POLICY_JSON_PATH is not set', () => {
      delete process.env.POLICY_JSON_PATH;
      const svc = new PolicyService();

      // Change the internal state
      (svc as any)._body = { ...(svc as any)._body, version: 999 };
      (svc as any)._etag = (svc as any).computeEtag((svc as any)._body);

      svc.reload();
      expect(svc.canonicalBody.version).toBe(1);
      expect(svc.etag).toMatch(/^"/);
    });
  });
});
