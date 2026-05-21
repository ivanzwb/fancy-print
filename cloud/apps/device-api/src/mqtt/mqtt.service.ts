import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { connect, type MqttClient } from 'mqtt';
import { telemetryMqttReceivedTotal } from '../common/metrics';
import { findForbiddenTelemetryKey } from '../common/telemetry-payload.guard';
import type { JobRecord } from '../jobs/job.types';

const TELEMETRY_MAX_BYTES = 4096;

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client?: MqttClient;

  onModuleInit() {
    const url = process.env.MQTT_URL?.trim();
    if (!url) {
      this.logger.log('MQTT_URL not set; job status publish disabled');
      return;
    }
    this.client = connect(url);
    this.client.on('error', (err) =>
      this.logger.warn(`MQTT client error: ${err.message}`),
    );
    this.client.on('connect', () => {
      this.logger.log(`MQTT connected to ${url}`);
      const wantSub = ['1', 'true', 'yes'].includes(
        (process.env.MQTT_SUBSCRIBE_TELEMETRY ?? '').toLowerCase(),
      );
      if (wantSub) {
        this.client!.subscribe('devices/+/telemetry', { qos: 1 }, (err) => {
          if (err) {
            this.logger.warn(`telemetry subscribe failed: ${err.message}`);
          } else {
            this.logger.log(
              'Subscribed devices/+/telemetry (cloud ingest stub; see MQTT_SUBSCRIBE_TELEMETRY)',
            );
          }
        });
      }
    });
    this.client.on('message', (topic, payload) => {
      this.onBrokerMessage(topic, payload);
    });
  }

  onModuleDestroy() {
    this.client?.end(true);
  }

  publishJobStatus(job: JobRecord) {
    if (!this.client?.connected || !job.device_id) return;
    const topic = `devices/${job.device_id}/jobs/${job.job_id}/status`;
    const previewTtlSec =
      job.preview_url_expires_at != null
        ? Math.max(
            0,
            Math.ceil(
              (new Date(job.preview_url_expires_at).getTime() - Date.now()) /
                1000,
            ),
          )
        : null;
    const payload = {
      state: job.state,
      preview_url: job.preview_url ?? null,
      preview_url_ttl: previewTtlSec,
      preview_url_expires_at: job.preview_url_expires_at ?? null,
      transcript: job.transcript ?? null,
      chunks_max_seq: job.chunks_max_seq ?? null,
      error_code: job.error_code ?? null,
      policy_version: job.policy_version ?? null,
    };
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) this.logger.warn(`MQTT publish failed: ${err.message}`);
    });
  }

  publishPolicy(deviceId: string, body: unknown, version: number) {
    if (!this.client?.connected) return;
    const topic = `devices/${deviceId}/policy`;
    const payload = {
      version,
      hash: version,
      apply_after: new Date().toISOString(),
      body,
    };
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
  }

  private onBrokerMessage(topic: string, payload: Buffer) {
    if (!/^devices\/[^/]+\/telemetry$/.test(topic)) return;

    if (payload.length > TELEMETRY_MAX_BYTES) {
      telemetryMqttReceivedTotal.inc({ result: 'oversize' });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(payload.toString('utf8'));
    } catch {
      telemetryMqttReceivedTotal.inc({ result: 'invalid_json' });
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      telemetryMqttReceivedTotal.inc({ result: 'invalid_shape' });
      return;
    }
    const rec = body as Record<string, unknown>;
    const bad = findForbiddenTelemetryKey(rec);
    if (bad) {
      telemetryMqttReceivedTotal.inc({ result: 'forbidden_field' });
      this.logger.warn(`telemetry_mqtt rejected forbidden field: ${bad}`);
      return;
    }

    const deviceId = topic.split('/')[1] ?? '?';
    const fw =
      typeof rec.firmware_version === 'string'
        ? rec.firmware_version.slice(0, 64)
        : '-';
    telemetryMqttReceivedTotal.inc({ result: 'accepted' });
    this.logger.log(
      `telemetry_mqtt device_id=${deviceId} firmware_version=${fw}`,
    );
  }
}
