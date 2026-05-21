import { Registry, collectDefaultMetrics, Counter } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestsTotal = new Counter({
  name: 'fancy_print_device_http_requests_total',
  help: 'HTTP requests processed by device-api',
  labelNames: ['method', 'status'],
  registers: [metricsRegistry],
});

/** doc/4 §2.4.3 HTTPS 遥测桩（无 device_id 标签，避免高基数） */
export const deviceTelemetryPostsTotal = new Counter({
  name: 'fancy_print_device_telemetry_posts_total',
  help: 'POST /v1/devices/telemetry ingests',
  labelNames: ['result'],
  registers: [metricsRegistry],
});

/** MQTT `devices/+/telemetry` messages (when MQTT_SUBSCRIBE_TELEMETRY is enabled) */
export const telemetryMqttReceivedTotal = new Counter({
  name: 'fancy_print_device_telemetry_mqtt_received_total',
  help: 'Inbound MQTT telemetry messages on devices/+/telemetry',
  labelNames: ['result'],
  registers: [metricsRegistry],
});
