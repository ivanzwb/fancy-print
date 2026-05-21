import { Injectable } from '@nestjs/common';
import type { ImageGenAdapter, ImageGenAdapterInput } from './image-gen-adapter.interface';

@Injectable()
export class StubImageGenAdapter implements ImageGenAdapter {
  async generate(_input: ImageGenAdapterInput): Promise<null> {
    return null;
  }
}
