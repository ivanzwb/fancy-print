import { Injectable } from '@nestjs/common';
import type { AsrAdapter, AsrAdapterInput } from './asr-adapter.interface';

@Injectable()
export class StubAsrAdapter implements AsrAdapter {
  usesAudioStaging(): boolean {
    return false;
  }

  async transcribe(_input: AsrAdapterInput): Promise<string | null> {
    return null;
  }
}
