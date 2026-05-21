import { PipelineQueueService } from './pipeline-queue.service';

function createService(concurrency?: string): PipelineQueueService {
  if (concurrency !== undefined) {
    process.env.PIPELINE_QUEUE_CONCURRENCY = concurrency;
  } else {
    delete process.env.PIPELINE_QUEUE_CONCURRENCY;
  }
  return new PipelineQueueService();
}

describe('PipelineQueueService', () => {
  afterEach(() => {
    delete process.env.PIPELINE_QUEUE_CONCURRENCY;
  });

  describe('initialization', () => {
    it('should default to concurrency 2', () => {
      const service = createService();
      expect((service as any).maxConcurrency).toBe(2);
      expect((service as any).pending.length).toBe(0);
      service.onModuleDestroy();
    });

    it('should respect PIPELINE_QUEUE_CONCURRENCY env var', () => {
      const service = createService('4');
      expect((service as any).maxConcurrency).toBe(4);
      service.onModuleDestroy();
    });

    it('should cap concurrency at 16', () => {
      const service = createService('100');
      expect((service as any).maxConcurrency).toBe(16);
      service.onModuleDestroy();
    });

    it('should floor concurrency at 1', () => {
      const service = createService('0');
      expect((service as any).maxConcurrency).toBe(1);
      service.onModuleDestroy();
    });
  });

  describe('enqueue', () => {
    it('should run up to concurrency tasks immediately', () => {
      const service = createService('2');
      const blocker = () => new Promise<void>(() => { /* never resolve */ });
      const never = () => new Promise<void>(() => { /* never start */ });

      service.enqueue('a', blocker);
      service.enqueue('b', blocker);
      service.enqueue('c', never);

      expect((service as any).running).toBe(2);
      expect((service as any).pending.length).toBe(1);
      service.onModuleDestroy();
    });

    it('should drop tasks after destroy', () => {
      const service = createService();
      const fn = jest.fn();
      service.onModuleDestroy();
      service.enqueue('x', fn);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should drain pending and running tasks', async () => {
      const service = createService('2');
      let resolved = 0;
      const slow = () =>
        new Promise<void>((resolve) => {
          setTimeout(() => { resolved++; resolve(); }, 5);
        });

      service.enqueue('a', slow);
      service.enqueue('b', slow);
      await new Promise((r) => setImmediate(r));

      await service.onModuleDestroy();
      expect(resolved).toBe(2);
    });

    it('should resolve immediately when queue is empty', async () => {
      const service = createService();
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
