import { Module } from '@nestjs/common';
import { S3AudioStagingService } from './s3-audio-staging.service';
import { S3PreviewService } from './s3-preview.service';
import { VendorFacadeService } from './vendor-facade.service';
import { VendorHttpService } from './vendor-http.service';
import { VendorStubsService } from './vendor-stubs.service';
import { IflytekIatAsrAdapter } from './vendors/iflytek-iat-asr.adapter';
import { StubAsrAdapter } from './vendors/stub-asr.adapter';
import { StubImageGenAdapter } from './vendors/stub-image-gen.adapter';
import { TongyiWanxiangImageGenAdapter } from './vendors/tongyi-wanxiang-image-gen.adapter';
import {
  createAsrAdapter,
  createImageGenAdapter,
} from './vendors/vendor-adapter.factory';
import { ASR_ADAPTER, IMAGE_GEN_ADAPTER } from './vendors/vendor-adapters.tokens';

@Module({
  providers: [
    VendorStubsService,
    VendorHttpService,
    StubAsrAdapter,
    StubImageGenAdapter,
    IflytekIatAsrAdapter,
    TongyiWanxiangImageGenAdapter,
    {
      provide: ASR_ADAPTER,
      useFactory: createAsrAdapter,
      inject: [IflytekIatAsrAdapter, StubAsrAdapter],
    },
    {
      provide: IMAGE_GEN_ADAPTER,
      useFactory: createImageGenAdapter,
      inject: [TongyiWanxiangImageGenAdapter, StubImageGenAdapter],
    },
    S3PreviewService,
    S3AudioStagingService,
    VendorFacadeService,
  ],
  exports: [VendorFacadeService, VendorStubsService, S3AudioStagingService],
})
export class AdaptersModule {}
