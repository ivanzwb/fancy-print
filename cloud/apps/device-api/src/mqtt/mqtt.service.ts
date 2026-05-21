import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { connect, type MqttClient } from 'mqtt';
import type { JobRecord } from '../jobs/job.types';

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
    this.client.on('connect', () =>
      this.logger.log(`MQTT connected to ${url}`),
    );
  }

  onModuleDestroy() {
    this.client?.end(true);
  }

  publishJobStatus(job: JobRecord) {
    if (!this.client?.connected || !job.device_id) return;
    const topic = `devices/${job.device_id}/jobs/${job.job_id}/status`;
    const payload = {
      state: job.state,
      preview_url: job.preview_url,
      preview_url_ttl: job.preview_url_expires_at,
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
}
