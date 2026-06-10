import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Public } from '../common/public.decorator';

const MAX_BODY_BYTES = 15 * 1024 * 1024;
const DECODED_BYTES_LIMIT = 12 * 1024 * 1024;

@Controller('works')
export class WorksController {
  private readonly logger = new Logger(WorksController.name);
  private dirInitialised = false;

  private worksDir(): string {
    return resolve(process.env.WORKS_SAVE_DIR?.trim() ?? '/tmp/fancy-print/works');
  }

  private async ensureDir(): Promise<void> {
    if (this.dirInitialised) return;
    await mkdir(this.worksDir(), { recursive: true });
    this.dirInitialised = true;
  }

  @Public()
  @Post('save')
  async save(
    @Body() body: Record<string, unknown>,
    @Req() _req: FastifyRequest,
  ): Promise<{ work_id: string; status: string }> {
    const rawBase64 = body?.image_base64;
    const transcript = typeof body?.transcript === 'string' ? body.transcript : '';

    if (typeof rawBase64 !== 'string' || !rawBase64.trim()) {
      throw new BadRequestException({
        code: 'MISSING_IMAGE',
        message: 'image_base64 is required',
      });
    }

    const imageBase64 = rawBase64.trim();
    if (Buffer.byteLength(imageBase64, 'utf8') > MAX_BODY_BYTES) {
      throw new BadRequestException({
        code: 'IMAGE_TOO_LARGE',
        message: 'image_base64 exceeds maximum size',
      });
    }

    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(imageBase64, 'base64');
    } catch {
      throw new BadRequestException({
        code: 'INVALID_BASE64',
        message: 'image_base64 is not valid base64',
      });
    }

    if (!imageBuffer.length || imageBuffer.length > DECODED_BYTES_LIMIT) {
      throw new BadRequestException({
        code: 'IMAGE_DATA_TOO_LARGE',
        message: 'Decoded image data is empty or exceeds limit',
      });
    }

    const workId = randomUUID();
    const filename = `${workId}.png`;
    const dest = join(this.worksDir(), filename);

    try {
      await this.ensureDir();
      await writeFile(dest, imageBuffer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to write work file: ${msg}`);
      throw new BadRequestException({
        code: 'SAVE_FAILED',
        message: 'Failed to save work',
      });
    }

    this.logger.log(`Work saved: ${workId} (${imageBuffer.length} bytes)`);

    return { work_id: workId, status: 'saved' };
  }
}
