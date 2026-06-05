import { Injectable } from '@nestjs/common';
import type { ImageGenAdapter, ImageGenAdapterInput } from './image-gen-adapter.interface';

@Injectable()
export class StubImageGenAdapter implements ImageGenAdapter {
  async generate(_input: ImageGenAdapterInput): Promise<{ imageBase64: string } | null> {
    // Return a tiny valid PNG as stub image (1x1 pixel blue dot)
    const stubPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    return { imageBase64: stubPngBase64 };
  }
}
