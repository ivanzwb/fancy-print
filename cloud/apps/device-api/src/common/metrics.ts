import { Registry, collectDefaultMetrics, Counter } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestsTotal = new Counter({
  name: 'fancy_print_device_http_requests_total',
  help: 'HTTP requests processed by device-api',
  labelNames: ['method', 'status'],
  registers: [metricsRegistry],
});
