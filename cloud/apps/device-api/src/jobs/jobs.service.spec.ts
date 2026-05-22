import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobStateStoreService } from './job-state-store.service';
import { PIPELINE_QUEUE, type IPipelineQueue } from './pipeline-queue.token';
import { S3AudioStagingService } from '../adapters/s3-audio-staging.service';
import { VendorFacadeService } from '../adapters/vendor-facade.service';
import { MqttService } from '../mqtt/mqtt.service';
import { PolicyService } from '../policy/policy.service';
import type { JobRecord } from './job.types';

function mockJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    job_id: 'job-1',
    device_id: 'dev-1',
    content_mode: 'coloring_quiet_book',
    state: 'created',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('JobsService', () => {
  let service: JobsService;
  let store: jest.Mocked<JobStateStoreService>;
  let mqtt: jest.Mocked<MqttService>;
  let policy: jest.Mocked<PolicyService>;
  let vendorFacade: jest.Mocked<VendorFacadeService>;
  let pipelineQueue: jest.Mocked<IPipelineQueue>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: JobStateStoreService,
          useValue: {
            usesRedis: jest.fn().mockReturnValue(false),
            getJob: jest.fn(),
            setJob: jest.fn(),
            deleteJob: jest.fn(),
            getCreateIdem: jest.fn(),
            setCreateIdemNx: jest.fn(),
            getPrintIdem: jest.fn(),
            setPrintIdem: jest.fn(),
            exportMemorySnapshot: jest.fn(),
            acquireJobAdvanceLock: jest.fn(),
            releaseJobAdvanceLock: jest.fn(),
          },
        },
        {
          provide: MqttService,
          useValue: {
            publishJobStatus: jest.fn(),
            publishPolicy: jest.fn(),
          },
        },
        {
          provide: PolicyService,
          useValue: {
            canonicalBody: {
              content_modes_allowed: [
                'coloring_quiet_book',
                'paper_craft',
                'dress_up',
              ] as readonly string[],
            },
          },
        },
        {
          provide: VendorFacadeService,
          useValue: {
            resolveTranscript: jest.fn(),
            moderateTranscript: jest.fn(),
            runImageGeneration: jest.fn(),
            finalizePreview: jest.fn(),
          },
        },
        {
          provide: PIPELINE_QUEUE,
          useValue: {
            enqueue: jest.fn(),
            onModuleDestroy: jest.fn(),
          },
        },
        {
          provide: S3AudioStagingService,
          useValue: {
            isConfigured: jest.fn().mockReturnValue(false),
            stageAudio: jest.fn(),
            presignedGetUrlForKey: jest.fn(),
            presignedGetUrlForJobAudio: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(JobsService);
    store = module.get(JobStateStoreService) as jest.Mocked<JobStateStoreService>;
    mqtt = module.get(MqttService) as jest.Mocked<MqttService>;
    policy = module.get(PolicyService) as jest.Mocked<PolicyService>;
    vendorFacade = module.get(VendorFacadeService) as jest.Mocked<VendorFacadeService>;
    pipelineQueue = module.get(PIPELINE_QUEUE) as jest.Mocked<IPipelineQueue>;
  });

  describe('createJob', () => {
    it('should create a job with valid params', async () => {
      store.getCreateIdem.mockResolvedValue(undefined);
      store.setJob.mockResolvedValue(undefined);
      store.setCreateIdemNx.mockResolvedValue(true);

      const result = await service.createJob({
        content_mode: 'coloring_quiet_book',
        device_id: 'dev-1',
      });

      expect(result.job_id).toBeTruthy();
      expect(result.state).toBe('created');
      expect(result.device_id).toBe('dev-1');
      expect(result.content_mode).toBe('coloring_quiet_book');
      expect(store.setJob).toHaveBeenCalled();
      expect(mqtt.publishJobStatus).toHaveBeenCalled();
    });

    it('should reject empty content_mode', async () => {
      await expect(
        service.createJob({ content_mode: '', device_id: 'dev-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject unsupported content_mode', async () => {
      await expect(
        service.createJob({ content_mode: 'invalid_mode', device_id: 'dev-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle idempotent create', async () => {
      const existingJob = mockJob({ job_id: 'existing-1' });
      store.getCreateIdem.mockResolvedValue('existing-1');
      store.getJob.mockResolvedValue(existingJob);

      const result = await service.createJob({
        content_mode: 'coloring_quiet_book',
        device_id: 'dev-1',
        idempotencyKey: 'dup-key',
      });

      expect(result.job_id).toBe('existing-1');
      // Should NOT create a second job
      expect(store.setJob).not.toHaveBeenCalled();
    });

    it('should reject idempotent create with device mismatch', async () => {
      const existingJob = mockJob({ job_id: 'existing-2', device_id: 'other-dev' });
      store.getCreateIdem.mockResolvedValue('existing-2');
      store.getJob.mockResolvedValue(existingJob);

      await expect(
        service.createJob({
          content_mode: 'coloring_quiet_book',
          device_id: 'dev-1',
          idempotencyKey: 'dup-key',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getJob', () => {
    it('should return a job when found', async () => {
      store.getJob.mockResolvedValue(mockJob());

      const result = await service.getJob('job-1', 'dev-1');
      expect(result.job_id).toBe('job-1');
      expect(result.state).toBe('created');
    });

    it('should throw when job not found', async () => {
      store.getJob.mockResolvedValue(undefined);

      await expect(service.getJob('nonexistent', 'dev-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw on device mismatch', async () => {
      store.getJob.mockResolvedValue(mockJob({ device_id: 'other-dev' }));

      await expect(service.getJob('job-1', 'dev-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should strip internal fields from the response', async () => {
      store.getJob.mockResolvedValue(
        mockJob({
          audio_base64: 'AAAA',
          pending_preview_image_url: 'http://internal/img',
        }),
      );

      const result = await service.getJob('job-1', 'dev-1');
      expect((result as any).audio_base64).toBeUndefined();
      expect((result as any).pending_preview_image_url).toBeUndefined();
    });
  });

  describe('advanceJob', () => {
    it('should enqueue background pipeline for audio_received job', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'audio_received' }));
      pipelineQueue.enqueue.mockImplementation((_jobId, _deviceId, fn) => {
        fn().catch(() => {});
      });

      const result = await service.advanceJob('job-1', 'dev-1');

      expect(result.job_id).toBe('job-1');
      expect(pipelineQueue.enqueue).toHaveBeenCalled();
      expect(result.state).toBe('audio_received'); // immediate return, not advanced
    });

    it('should return job unchanged for failed state', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'failed' }));

      const result = await service.advanceJob('job-1', 'dev-1');
      expect(result.state).toBe('failed');
      expect(pipelineQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should return job unchanged for print_acknowledged state', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'print_acknowledged' }));

      const result = await service.advanceJob('job-1', 'dev-1');
      expect(result.state).toBe('print_acknowledged');
      expect(pipelineQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should return job unchanged for preview_ready state', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'preview_ready' }));

      const result = await service.advanceJob('job-1', 'dev-1');
      expect(result.state).toBe('preview_ready');
      expect(pipelineQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should return job unchanged for created state (no audio yet)', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'created' }));

      const result = await service.advanceJob('job-1', 'dev-1');
      expect(result.state).toBe('created');
      expect(pipelineQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should throw on device mismatch', async () => {
      store.getJob.mockResolvedValue(mockJob({ device_id: 'other-dev' }));

      await expect(service.advanceJob('job-1', 'dev-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('attachAudio', () => {
    it('should attach audio and advance state to audio_received', async () => {
      store.getJob.mockResolvedValue(mockJob());
      store.setJob.mockResolvedValue(undefined);

      const result = await service.attachAudio('job-1', 'dev-1', 'AAAAb64');

      expect(result.state).toBe('audio_received');
      expect((result as any).audio_base64).toBeUndefined(); // stripped from API response
      expect(store.setJob).toHaveBeenCalled();
      expect(mqtt.publishJobStatus).toHaveBeenCalled();
    });

    it('should cap audio base64 at 4MB', async () => {
      store.getJob.mockResolvedValue(mockJob());
      store.setJob.mockResolvedValue(undefined);

      const long = 'A'.repeat(5_000_000);
      await service.attachAudio('job-1', 'dev-1', long);

      // The store receives the capped version
      const storedJob = store.setJob.mock.calls[0][0] as JobRecord;
      expect(storedJob.audio_base64!.length).toBe(4_000_000);
    });

    it('should throw ConflictException when job is already failed', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'failed' }));

      await expect(
        service.attachAudio('job-1', 'dev-1', 'AAAA'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if not in created state', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'asr_complete' }));

      await expect(
        service.attachAudio('job-1', 'dev-1', 'AAAA'),
      ).rejects.toThrow(ConflictException);
    });

    it('should silently succeed for already finished jobs', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'preview_ready' }));

      const result = await service.attachAudio('job-1', 'dev-1', 'AAAA');
      expect(result.state).toBe('preview_ready');
      expect(store.setJob).not.toHaveBeenCalled();
    });
  });

  describe('printAck', () => {
    it('should acknowledge a job', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'preview_ready' }));
      store.getPrintIdem.mockResolvedValue(undefined);
      store.setPrintIdem.mockResolvedValue(undefined);
      store.setJob.mockResolvedValue(undefined);

      const result = await service.printAck('job-1', 'dev-1', 'ack-key');

      expect(result.accepted).toBe(true);
      expect(result.idempotent_replay).toBe(false);
      expect(store.setJob).toHaveBeenCalled();
    });

    it('should reject missing idempotency key', async () => {
      await expect(service.printAck('job-1', 'dev-1', '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject print-ack for failed job', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'failed' }));

      await expect(
        service.printAck('job-1', 'dev-1', 'ack-key'),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject print-ack for non-preview_ready job', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'created' }));

      await expect(
        service.printAck('job-1', 'dev-1', 'ack-key'),
      ).rejects.toThrow(ConflictException);
    });

    it('should return idempotent replay for duplicate key', async () => {
      store.getPrintIdem.mockResolvedValue({
        job_id: 'job-1',
        accepted_at: '2026-01-01T00:00:00.000Z',
      });

      const result = await service.printAck('job-1', 'dev-1', 'dup-key');

      expect(result.accepted).toBe(true);
      expect(result.idempotent_replay).toBe(true);
      expect(store.setJob).not.toHaveBeenCalled();
    });

    it('should throw ConflictException on idempotency key reuse for different job', async () => {
      store.getPrintIdem.mockResolvedValue({
        job_id: 'other-job',
        accepted_at: '2026-01-01T00:00:00.000Z',
      });

      await expect(
        service.printAck('job-1', 'dev-1', 'dup-key'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getArtifactRedirectUrl', () => {
    it('should return preview_url when job is preview_ready', async () => {
      store.getJob.mockResolvedValue(
        mockJob({
          state: 'preview_ready',
          preview_url: 'https://cdn.example.com/preview.png',
        }),
      );

      const url = await service.getArtifactRedirectUrl('job-1', 'dev-1');
      expect(url).toBe('https://cdn.example.com/preview.png');
    });

    it('should return null when job has no preview_url', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'preview_ready' }));

      const url = await service.getArtifactRedirectUrl('job-1', 'dev-1');
      expect(url).toBeNull();
    });

    it('should return null for non-ready jobs', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'created' }));

      const url = await service.getArtifactRedirectUrl('job-1', 'dev-1');
      expect(url).toBeNull();
    });
  });

  describe('uploadChunk', () => {
    it('should delegate to attachAudio when body is empty', async () => {
      store.getJob.mockResolvedValue(mockJob());
      store.setJob.mockResolvedValue(undefined);

      const result = await service.uploadChunk('job-1', 'dev-1', {});
      expect(result.state).toBe('audio_received');
    });

    it('should delegate to attachAudio when final:true with no seq', async () => {
      store.getJob.mockResolvedValue(mockJob());
      store.setJob.mockResolvedValue(undefined);

      const result = await service.uploadChunk('job-1', 'dev-1', { final: true });
      expect(result.state).toBe('audio_received');
    });

    it('should reject chunk without seq and final=false', async () => {
      store.getJob.mockResolvedValue(mockJob());

      await expect(
        service.uploadChunk('job-1', 'dev-1', { final: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject chunk without final when seq provided', async () => {
      store.getJob.mockResolvedValue(mockJob());

      await expect(
        service.uploadChunk('job-1', 'dev-1', { seq: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject negative seq', async () => {
      store.getJob.mockResolvedValue(mockJob());

      await expect(
        service.uploadChunk('job-1', 'dev-1', { seq: -1, final: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject chunks for non-created state', async () => {
      store.getJob.mockResolvedValue(mockJob({ state: 'asr_complete' }));

      await expect(
        service.uploadChunk('job-1', 'dev-1', { seq: 0, final: false }),
      ).rejects.toThrow(ConflictException);
    });

    it('should return idempotent response for duplicate seq', async () => {
      const job = mockJob();
      job.chunks_max_seq = 2;
      store.getJob.mockResolvedValue(job);

      const result = await service.uploadChunk('job-1', 'dev-1', {
        seq: 1,
        final: false,
        audio_base64: 'frag1',
      });
      expect(result.state).toBe('created');
      // Store should NOT be called for duplicate seq
      expect(store.setJob).not.toHaveBeenCalled();
    });

    it('should merge chunks and finalize on final:true', async () => {
      store.getJob.mockResolvedValue(mockJob());
      store.setJob.mockResolvedValue(undefined);

      await service.uploadChunk('job-1', 'dev-1', {
        seq: 0,
        final: true,
        audio_base64: Buffer.from('hello').toString('base64'),
      });

      const storedJob = store.setJob.mock.calls[0][0] as JobRecord;
      expect(storedJob.state).toBe('audio_received');
      expect(storedJob.chunks_max_seq).toBeUndefined();
      expect(storedJob.audio_chunk_buffers).toBeUndefined();
      expect(storedJob.audio_base64).toBeDefined();
    });
  });
});
