import { Test, TestingModule } from '@nestjs/testing';
import { AsrController } from './asr.controller';
import { ASR_ADAPTER } from '../adapters/vendors/vendor-adapters.tokens';
import { JobsService } from '../jobs/jobs.service';
import type { AsrAdapter } from '../adapters/vendors/asr-adapter.interface';

describe('AsrController', () => {
  let controller: AsrController;
  let asr: jest.Mocked<AsrAdapter>;
  let jobs: jest.Mocked<JobsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AsrController],
      providers: [
        {
          provide: ASR_ADAPTER,
          useValue: {
            transcribe: jest.fn(),
            usesAudioStaging: jest.fn(),
          },
        },
        {
          provide: JobsService,
          useValue: {
            createJobFromTranscript: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AsrController);
    asr = module.get(ASR_ADAPTER) as jest.Mocked<AsrAdapter>;
    jobs = module.get(JobsService) as jest.Mocked<JobsService>;
  });

  it('returns transcript without creating a job when create_job is false', async () => {
    asr.transcribe.mockResolvedValue('返回主页');

    const result = await controller.transcribe(
      { audio_base64: 'abc', create_job: false },
      'device-1',
    );

    expect(result).toEqual({ text: '返回主页' });
    expect(jobs.createJobFromTranscript).not.toHaveBeenCalled();
  });

  it('keeps the existing default behavior of creating a job', async () => {
    asr.transcribe.mockResolvedValue('画一只小兔子');
    jobs.createJobFromTranscript.mockResolvedValue({
      job_id: 'job-1',
      state: 'created',
    } as any);

    const result = await controller.transcribe(
      { audio_base64: 'abc', content_mode: 'coloring' },
      'device-1',
    );

    expect(jobs.createJobFromTranscript).toHaveBeenCalledWith({
      content_mode: 'coloring',
      device_id: 'device-1',
      transcript: '画一只小兔子',
    });
    expect(result).toEqual({
      text: '画一只小兔子',
      job_id: 'job-1',
      state: 'created',
    });
  });
});
