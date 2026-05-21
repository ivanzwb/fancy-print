import { Module } from '@nestjs/common';
import { S3PreviewService } from './s3-preview.service';
import { VendorFacadeService } from './vendor-facade.service';
import { VendorHttpService } from './vendor-http.service';
import { VendorStubsService } from './vendor-stubs.service';

@Module({
  providers: [
    VendorStubsService,
    VendorHttpService,
    S3PreviewService,
    VendorFacadeService,
  ],
  exports: [VendorFacadeService, VendorStubsService],
})
export class AdaptersModule {}