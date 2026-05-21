import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'node:fs';

/**
 * 合并 `DEVICE_DEV_CREDENTIALS` 与可选文件注册表（量产可换为 DB）。
 * 文件格式：`{ "device_id": "secret", ... }` 或 `{ "devices": [{ "id", "secret" }] }`。
 */
@Injectable()
export class DeviceRegistryService implements OnModuleInit {
  private readonly logger = new Logger(DeviceRegistryService.name);
  private readonly secrets = new Map<string, string>();

  onModuleInit() {
    this.loadFromEnv();
    this.loadFromFile();
  }

  private loadFromEnv() {
    const raw =
      process.env.DEVICE_DEV_CREDENTIALS ??
      '{"fancy-print-dev":"fancy-print-secret"}';
    try {
      const creds = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(creds)) {
        if (k?.trim() && typeof v === 'string') this.secrets.set(k.trim(), v);
      }
    } catch {
      this.secrets.set('fancy-print-dev', 'fancy-print-secret');
    }
  }

  private loadFromFile() {
    const path = process.env.DEVICE_REGISTRY_JSON_PATH?.trim();
    if (!path) return;
    try {
      const raw = fs.readFileSync(path, 'utf8');
      const j = JSON.parse(raw) as unknown;
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        const o = j as Record<string, unknown>;
        if (Array.isArray(o.devices)) {
          for (const row of o.devices) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
            const r = row as Record<string, unknown>;
            const id = typeof r.id === 'string' ? r.id.trim() : '';
            const sec = typeof r.secret === 'string' ? r.secret : '';
            if (id && sec) this.secrets.set(id, sec);
          }
        } else {
          for (const [k, v] of Object.entries(o)) {
            if (k === 'devices') continue;
            if (typeof v === 'string' && k.trim()) this.secrets.set(k.trim(), v);
          }
        }
      }
      this.logger.log(`Device registry merged from ${path} (${this.secrets.size} ids)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`DEVICE_REGISTRY_JSON_PATH read failed (${path}): ${msg}`);
    }
  }

  validate(deviceId: string, deviceSecret: string): boolean {
    const expected = this.secrets.get(deviceId);
    return !!expected && expected === deviceSecret;
  }

  hasDevice(deviceId: string): boolean {
    return this.secrets.has(deviceId);
  }

  /** For `MTLS_TRUST_REGISTERED_DEVICES`: any id present in registry may exchange. */
  registeredIds(): IterableIterator<string> {
    return this.secrets.keys();
  }
}
