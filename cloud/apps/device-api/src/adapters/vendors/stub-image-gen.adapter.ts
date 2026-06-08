import { Injectable } from '@nestjs/common';
import type { ImageGenAdapter, ImageGenAdapterInput } from './image-gen-adapter.interface';

@Injectable()
export class StubImageGenAdapter implements ImageGenAdapter {
  async generate(_input: ImageGenAdapterInput): Promise<{ imageBase64: string } | null> {
    throw new Error(
      'IMAGE_GEN_STUB: 未配置图片生成服务。请设置环境变量：\n' +
      '  - DASHSCOPE_API_KEY=your-key (通义万相)\n' +
      '  - IMAGE_GEN_DRIVER=auto 或 tongyi\n' +
      '详见 cloud/apps/device-api/README.md'
    );
  }
}
