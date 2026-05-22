import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connect, type MqttClient } from 'mqtt';

/**
 * Parent-BFF MQTT publisher — 向设备推送审批结果与策略变更。
 *
 * 可选服务：仅当 `MQTT_URL` 已配置时启用。
 * 与 device-api 的 MqttService 共用同一 MQTT Broker（EMQX）。
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client?: MqttClient;

  onModuleInit() {
    const url = process.env.MQTT_URL?.trim() || process.env.PARENT_MQTT_URL?.trim();
    if (!url) {
      this.logger.log('MQTT_URL not set; device notifications disabled');
      return;
    }
    this.client = connect(url, {
      rejectUnauthorized: false,
    });
    this.client.on('error', (err) =>
      this.logger.warn(`MQTT client error: ${err.message}`),
    );
    this.client.on('connect', () => {
      this.logger.log(`MQTT connected to ${url}`);
    });
  }

  onModuleDestroy() {
    this.client?.end(true);
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * 家长审批/拒绝后，向设备推送审批结果。
   * topic: devices/{deviceId}/jobs/{jobId}/approval
   */
  publishApproval(deviceId: string, jobId: string, status: 'approved' | 'rejected') {
    if (!this.client?.connected) return;
    const topic = `devices/${deviceId}/jobs/${jobId}/approval`;
    const payload = {
      job_id: jobId,
      status,
      decided_at: new Date().toISOString(),
    };
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) this.logger.warn(`MQTT publish approval failed: ${err.message}`);
    });
  }

  /**
   * 策略变更后，向设备推送最新策略。
   * topic: devices/{deviceId}/policy
   */
  publishPolicy(deviceId: string, version: number, body: Record<string, unknown>) {
    if (!this.client?.connected) return;
    const topic = `devices/${deviceId}/policy`;
    const payload = {
      version,
      hash: version,
      apply_after: new Date().toISOString(),
      body,
    };
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) this.logger.warn(`MQTT publish policy failed: ${err.message}`);
    });
  }
}
