import { Test, TestingModule } from '@nestjs/testing';
import { VendorFacadeService } from './vendor-facade.service';
import { VendorHttpService } from './vendor-http.service';
import { VendorStubsService } from './vendor-stubs.service';
import { S3AudioStagingService } from './s3-audio-staging.service';
import { S3PreviewService } from './s3-preview.service';
import { ASR_ADAPTER, IMAGE_GEN_ADAPTER } from './vendors/vendor-adapters.tokens';
import type { AsrAdapter } from './vendors/asr-adapter.interface';
import type { ImageGenAdapter } from './vendors/image-gen-adapter.interface';
import type { JobRecord } from '../jobs/job.types';

function baseJob(overrides: Partial<JobRecord> = {}): JobRecord {
  const now = new Date().toISOString();
  return {
    job_id: 'job-1',
    device_id: 'dev-1',
    content_mode: 'coloring_quiet_book',
    state: 'asr_complete',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('VendorFacadeService', () => {
  let service: VendorFacadeService;
  let asr: jest.Mocked<AsrAdapter>;
  let imageGen: jest.Mocked<ImageGenAdapter>;
  let http: jest.Mocked<VendorHttpService>;
  let s3: jest.Mocked<S3PreviewService>;
  let audioStaging: jest.Mocked<S3AudioStagingService>;
  let stub: VendorStubsService;

  beforeEach(async () => {
    delete process.env.ASR_SEND_BASE64_WITH_PRESIGNED;
    delete process.env.ASR_HTTP_SEND_BASE64_WITH_PRESIGNED;

    asr = {
      usesAudioStaging: jest.fn().mockReturnValue(false),
      transcribe: jest.fn().mockResolvedValue(null),
    };
    imageGen = {
      generate: jest.fn().mockResolvedValue(null),
    };
    http = {
      moderateTextViaHttp: jest.fn().mockResolvedValue({ ok: true }),
      moderateImageViaHttp: jest.fn().mockResolvedValue({ ok: true }),
    } as unknown as jest.Mocked<VendorHttpService>;
    s3 = {
      uploadJobPreviewFromBase64: jest.fn().mockResolvedValue(false),
      presignPreviewIfConfigured: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<S3PreviewService>;
    audioStaging = {
      presignedGetUrlForKey: jest.fn(),
      presignedGetUrlForJobAudio: jest.fn(),
    } as unknown as jest.Mocked<S3AudioStagingService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorStubsService,
        VendorFacadeService,
        { provide: ASR_ADAPTER, useValue: asr },
        { provide: IMAGE_GEN_ADAPTER, useValue: imageGen },
        { provide: VendorHttpService, useValue: http },
        { provide: S3PreviewService, useValue: s3 },
        { provide: S3AudioStagingService, useValue: audioStaging },
      ],
    }).compile();

    service = module.get(VendorFacadeService);
    stub = module.get(VendorStubsService);
  });

  describe('resolveTranscript', () => {
    it('returns adapter transcript when ASR returns non-empty', async () => {
      asr.transcribe.mockResolvedValue('hello from adapter');
      const job = baseJob({ audio_base64: 'AAA' });
      await expect(service.resolveTranscript(job)).resolves.toBe(
        'hello from adapter',
      );
      expect(asr.transcribe).toHaveBeenCalled();
    });

    it('falls back to stub when adapter returns null', async () => {
      asr.transcribe.mockResolvedValue(null);
      const job = baseJob({ audio_base64: 'AAA' });
      const t = await service.resolveTranscript(job);
      expect(t).toBe(stub.stubTranscript(job));
    });

    it('with audio staging + s3 key, requests presigned URL', async () => {
      asr.usesAudioStaging.mockReturnValue(true);
      audioStaging.presignedGetUrlForKey.mockResolvedValue('https://signed');
      asr.transcribe.mockResolvedValue('ok');

      const job = baseJob({
        audio_s3_bucket: 'b',
        audio_s3_key: 'k',
        audio_base64: undefined,
      });
      await service.resolveTranscript(job);

      expect(audioStaging.presignedGetUrlForKey).toHaveBeenCalledWith('b', 'k');
      expect(asr.transcribe).toHaveBeenCalledWith(
        expect.objectContaining({
          audioPresignedUrl: 'https://signed',
        }),
      );
    });

    it('ASR_SEND_BASE64_WITH_PRESIGNED=1 still passes base64 alongside presigned', async () => {
      process.env.ASR_SEND_BASE64_WITH_PRESIGNED = '1';
      asr.usesAudioStaging.mockReturnValue(true);
      audioStaging.presignedGetUrlForJobAudio.mockResolvedValue(
        'https://signed-audio',
      );
      asr.transcribe.mockResolvedValue('x');

      const job = baseJob({ audio_base64: 'QQ==' });
      await service.resolveTranscript(job);

      expect(asr.transcribe).toHaveBeenCalledWith(
        expect.objectContaining({
          audioPresignedUrl: 'https://signed-audio',
          audioBase64: 'QQ==',
        }),
      );
    });
  });

  describe('moderateTranscript', () => {
    it('uses job.transcript when set', async () => {
      const job = baseJob({ transcript: 'user text' });
      await service.moderateTranscript(job);
      expect(http.moderateTextViaHttp).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: 'user text' }),
      );
    });

    it('uses stub transcript when job.transcript missing', async () => {
      const job = baseJob();
      delete job.transcript;
      await service.moderateTranscript(job);
      expect(http.moderateTextViaHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          transcript: stub.stubTranscript(job),
        }),
      );
    });
  });

  describe('runImageGeneration', () => {
    it('returns ok and sets pending fields when image URL passes moderation', async () => {
      imageGen.generate.mockResolvedValue({
        imageUrl: 'https://cdn.example.com/out.png',
      });
      const job = baseJob({ transcript: 't' });
      const r = await service.runImageGeneration(job);
      expect(r).toEqual({ ok: true });
      expect(job.pending_preview_image_url).toBe(
        'https://cdn.example.com/out.png',
      );
      expect(http.moderateImageViaHttp).toHaveBeenCalled();
    });

    it('returns failure when moderation rejects image', async () => {
      imageGen.generate.mockResolvedValue({ imageUrl: 'https://x/img.png' });
      http.moderateImageViaHttp.mockResolvedValue({
        ok: false,
        reason_code: 'BLOCKED',
      });
      const job = baseJob();
      const r = await service.runImageGeneration(job);
      expect(r).toEqual({ ok: false, reason_code: 'BLOCKED' });
    });

    it('returns IMAGE_MODERATION_UPSTREAM_ERROR when moderation throws', async () => {
      imageGen.generate.mockResolvedValue({ imageUrl: 'https://x/img.png' });
      http.moderateImageViaHttp.mockRejectedValue(new Error('timeout'));
      const job = baseJob();
      const r = await service.runImageGeneration(job);
      expect(r).toEqual({
        ok: false,
        reason_code: 'IMAGE_MODERATION_UPSTREAM_ERROR',
      });
    });

    it('returns IMAGE_GEN_UPSTREAM_ERROR when generate throws', async () => {
      imageGen.generate.mockRejectedValue(new Error('upstream'));
      const job = baseJob();
      const r = await service.runImageGeneration(job);
      expect(r).toEqual({ ok: false, reason_code: 'IMAGE_GEN_UPSTREAM_ERROR' });
    });

    it('uses stub preview when adapter returns no image', async () => {
      imageGen.generate.mockResolvedValue(null);
      const job = baseJob();
      const r = await service.runImageGeneration(job);
      expect(r).toEqual({ ok: true });
      expect(job.pending_preview_image_url).toMatch(
        /^https:\/\/example\.invalid\/preview\//,
      );
      expect(http.moderateImageViaHttp).not.toHaveBeenCalled();
    });
  });

  describe('finalizePreview', () => {
    it('returns pending URL directly when URL pending', async () => {
      const job = baseJob({
        pending_preview_image_url: '  https://ready.png  ',
      });
      const r = await service.finalizePreview(job, Date.now());
      expect(r.url).toBe('https://ready.png');
      expect(job.pending_preview_image_url).toBeUndefined();
    });

    it('uses data URL when only base64 pending and S3 upload unavailable', async () => {
      const job = baseJob({
        pending_preview_image_base64: Buffer.from('x').toString('base64'),
      });
      const r = await service.finalizePreview(job, Date.now());
      expect(r.url.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('delegates to stub when no pending and no S3 presign', async () => {
      const job = baseJob();
      const r = await service.finalizePreview(job, 1_700_000_000_000);
      expect(r.url).toContain('/preview/job-1.png');
    });
  });
});
