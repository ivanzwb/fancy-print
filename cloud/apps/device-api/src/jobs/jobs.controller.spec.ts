import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import type { JobRecord } from './job.types';

function mockReply(): jest.Mocked<FastifyReply> {
  return { header: jest.fn() } as any;
}

describe('JobsController', () => {
  let controller: JobsController;
  let jobs: jest.Mocked<JobsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        {
          provide: JobsService,
          useValue: {
            createJob: jest.fn(),
            getJob: jest.fn(),
            advanceJob: jest.fn(),
            attachAudio: jest.fn(),
            uploadChunk: jest.fn(),
            printAck: jest.fn(),
            getArtifactRedirectUrl: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(JobsController);
    jobs = module.get(JobsService) as jest.Mocked<JobsService>;
  });

  const dev = { device_id: 'dev-1' };
  const sampleJob: JobRecord = {
    job_id: '550e8400-e29b-41d4-a716-446655440000',
    device_id: 'dev-1',
    content_mode: 'coloring_quiet_book',
    state: 'created',
    policy_version: 1,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  };

  // ---------------------------------------------------------------------------
  // POST /v1/jobs
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('should return 201 with location header', async () => {
      jobs.createJob.mockResolvedValue(sampleJob);
      const reply = mockReply();

      const result = await controller.create(
        reply,
        dev,
        undefined,
        { content_mode: 'coloring_quiet_book' },
      );

      expect(jobs.createJob).toHaveBeenCalledWith({
        content_mode: 'coloring_quiet_book',
        device_id: 'dev-1',
        idempotencyKey: undefined,
        child_profile_id: undefined,
      });
      expect(reply.header).toHaveBeenCalledWith(
        'Location',
        `/v1/jobs/${sampleJob.job_id}`,
      );
      expect(result).toEqual(sampleJob);
    });

    it('should pass child_profile_id when provided', async () => {
      jobs.createJob.mockResolvedValue(sampleJob);
      const reply = mockReply();

      await controller.create(reply, dev, undefined, {
        content_mode: 'paper_craft',
        child_profile_id: 'profile-1',
      });

      expect(jobs.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ child_profile_id: 'profile-1' }),
      );
    });

    it('should pass trimmed idempotency key', async () => {
      jobs.createJob.mockResolvedValue(sampleJob);
      const reply = mockReply();

      await controller.create(reply, dev, '  idem-42  ', {
        content_mode: 'dress_up',
      });

      expect(jobs.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'idem-42' }),
      );
    });

    it('should not pass whitespace-only idempotency key', async () => {
      jobs.createJob.mockResolvedValue(sampleJob);
      const reply = mockReply();

      await controller.create(reply, dev, '   ', {
        content_mode: 'coloring_quiet_book',
      });

      expect(jobs.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: undefined }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // GET /v1/jobs/:jobId
  // ---------------------------------------------------------------------------
  describe('getOne', () => {
    it('should return job for valid id and device', async () => {
      jobs.getJob.mockResolvedValue(sampleJob);

      const result = await controller.getOne(sampleJob.job_id, dev);

      expect(jobs.getJob).toHaveBeenCalledWith(sampleJob.job_id, 'dev-1');
      expect(result).toEqual(sampleJob);
    });

    it('should throw NotFoundException for unknown job', async () => {
      jobs.getJob.mockRejectedValue(new NotFoundException());

      await expect(
        controller.getOne('unknown-id', dev),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for device mismatch', async () => {
      jobs.getJob.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.getOne(sampleJob.job_id, { device_id: 'other-dev' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /v1/jobs/:jobId/advance
  // ---------------------------------------------------------------------------
  describe('advance', () => {
    it('should call advanceJob with correct params', async () => {
      jobs.advanceJob.mockResolvedValue(sampleJob);

      const result = await controller.advance(sampleJob.job_id, dev);

      expect(jobs.advanceJob).toHaveBeenCalledWith(sampleJob.job_id, 'dev-1');
      expect(result).toEqual(sampleJob);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /v1/jobs/:jobId/audio
  // ---------------------------------------------------------------------------
  describe('uploadAudio', () => {
    it('should call attachAudio with base64 body', async () => {
      jobs.attachAudio.mockResolvedValue(sampleJob);

      const result = await controller.uploadAudio(sampleJob.job_id, dev, {
        audio_base64: '////0KG5',
      });

      expect(jobs.attachAudio).toHaveBeenCalledWith(
        sampleJob.job_id,
        'dev-1',
        '////0KG5',
      );
      expect(result).toEqual(sampleJob);
    });

    it('should call attachAudio without body', async () => {
      jobs.attachAudio.mockResolvedValue(sampleJob);

      await controller.uploadAudio(sampleJob.job_id, dev);

      expect(jobs.attachAudio).toHaveBeenCalledWith(
        sampleJob.job_id,
        'dev-1',
        undefined,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // POST /v1/jobs/:jobId/chunks
  // ---------------------------------------------------------------------------
  describe('uploadChunks', () => {
    it('should call jobs.uploadChunk with the body', async () => {
      jobs.uploadChunk.mockResolvedValue(sampleJob);
      const body = { seq: 1, final: false, audio_base64: 'AAAA' };

      const result = await controller.uploadChunks(
        sampleJob.job_id,
        dev,
        body,
      );

      expect(jobs.uploadChunk).toHaveBeenCalledWith(
        sampleJob.job_id,
        'dev-1',
        body,
      );
      expect(result).toEqual(sampleJob);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /v1/jobs/:jobId/print-ack
  // ---------------------------------------------------------------------------
  describe('printAck', () => {
    it('should call jobs.printAck with idempotency key', async () => {
      jobs.printAck.mockResolvedValue({
        job_id: sampleJob.job_id,
        accepted: true,
        accepted_at: '2025-01-01T00:00:00.000Z',
        idempotent_replay: false,
      });

      const result = await controller.printAck(
        sampleJob.job_id,
        dev,
        'print-ack-1',
      );

      expect(jobs.printAck).toHaveBeenCalledWith(
        sampleJob.job_id,
        'dev-1',
        'print-ack-1',
      );
      expect(result.accepted).toBe(true);
    });

    it('should pass undefined when idempotency-key header missing', async () => {
      jobs.printAck.mockRejectedValue(new Error('should not call'));

      await expect(
        controller.printAck(sampleJob.job_id, dev, undefined),
      ).rejects.toThrow();
    });
  });
});
