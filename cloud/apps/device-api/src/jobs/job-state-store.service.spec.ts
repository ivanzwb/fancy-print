import { Test, TestingModule } from '@nestjs/testing';
import { JobStateStoreService } from './job-state-store.service';
import type { JobRecord } from './job.types';

function sampleJob(id: string): JobRecord {
  const now = new Date().toISOString();
  return {
    job_id: id,
    device_id: 'dev-1',
    content_mode: 'coloring_quiet_book',
    state: 'created',
    created_at: now,
    updated_at: now,
  };
}

describe('JobStateStoreService (in-memory)', () => {
  let service: JobStateStoreService;
  const savedRedis = process.env.REDIS_URL;

  beforeEach(async () => {
    delete process.env.REDIS_URL;
    const module: TestingModule = await Test.createTestingModule({
      providers: [JobStateStoreService],
    }).compile();
    service = module.get(JobStateStoreService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    if (savedRedis !== undefined) process.env.REDIS_URL = savedRedis;
    else delete process.env.REDIS_URL;
  });

  it('usesRedis() is false without REDIS_URL', () => {
    expect(service.usesRedis()).toBe(false);
  });

  it('setJob / getJob round-trip', async () => {
    const job = sampleJob('job-a');
    await service.setJob(job);
    const got = await service.getJob('job-a');
    expect(got?.job_id).toBe('job-a');
    expect(got?.device_id).toBe('dev-1');
  });

  it('setJob clones into store (mutate local copy after set)', async () => {
    const job = sampleJob('job-b');
    await service.setJob(job);
    job.state = 'failed';
    const got = await service.getJob('job-b');
    expect(got?.state).toBe('created');
  });

  it('deleteJob removes job', async () => {
    await service.setJob(sampleJob('job-c'));
    await service.deleteJob('job-c');
    expect(await service.getJob('job-c')).toBeUndefined();
  });

  it('setCreateIdemNx is exclusive per key', async () => {
    const a = await service.setCreateIdemNx('idem-1', 'job-1');
    const b = await service.setCreateIdemNx('idem-1', 'job-2');
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(await service.getCreateIdem('idem-1')).toBe('job-1');
  });

  it('setPrintIdem / getPrintIdem', async () => {
    const v = { job_id: 'job-x', accepted_at: '2026-01-01T00:00:00.000Z' };
    await service.setPrintIdem('print-key', v);
    expect(await service.getPrintIdem('print-key')).toEqual(v);
  });

  it('acquireJobAdvanceLock returns null in memory mode', async () => {
    await expect(service.acquireJobAdvanceLock('any')).resolves.toBeNull();
  });

  it('releaseJobAdvanceLock is a no-op in memory mode', async () => {
    await expect(
      service.releaseJobAdvanceLock('any', 'token'),
    ).resolves.toBeUndefined();
  });

  it('exportMemorySnapshot reflects jobs and idempotency maps', async () => {
    await service.setJob(sampleJob('j1'));
    await service.setCreateIdemNx('c1', 'j1');
    await service.setPrintIdem('p1', {
      job_id: 'j1',
      accepted_at: '2026-01-02T00:00:00.000Z',
    });
    const snap = service.exportMemorySnapshot();
    expect(snap.jobs.some((j) => j.job_id === 'j1')).toBe(true);
    expect(snap.createIdempotency).toContainEqual(['c1', 'j1']);
    expect(snap.printAckIdempotency).toContainEqual([
      'p1',
      { job_id: 'j1', accepted_at: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  it('seedMemoryFromJobs loads into empty memory backend', async () => {
    const j = sampleJob('seed-1');
    j.state = 'preview_ready';
    service.seedMemoryFromJobs(
      [j],
      [['ik', 'seed-1']],
      [['pk', { job_id: 'seed-1', accepted_at: '2026-01-03T00:00:00.000Z' }]],
    );
    expect((await service.getJob('seed-1'))?.state).toBe('preview_ready');
    expect(await service.getCreateIdem('ik')).toBe('seed-1');
    expect((await service.getPrintIdem('pk'))?.job_id).toBe('seed-1');
  });
});
