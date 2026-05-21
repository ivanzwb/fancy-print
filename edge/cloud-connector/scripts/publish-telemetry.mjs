/**
 * Real MQTT client: publish doc/4 §2.4.3 `devices/{device_id}/telemetry` (JSON).
 *
 * Usage:
 *   set MQTT_URL=mqtt://127.0.0.1:1883
 *   set DEVICE_ID=fancy-print-dev
 *   npm run telemetry:publish
 */
import mqtt from 'mqtt';

const url = process.env.MQTT_URL?.trim();
const deviceId = process.env.DEVICE_ID?.trim() || 'fancy-print-dev';

if (!url) {
  console.error('MQTT_URL is required (e.g. mqtt://127.0.0.1:1883)');
  process.exit(1);
}

const topic = `devices/${deviceId}/telemetry`;
const payload = JSON.stringify({
  firmware_version: process.env.FIRMWARE_VERSION?.trim() || '0.0.0-dev',
  rssi_dbm: Number(process.env.RSSI_DBM ?? -62),
  uptime_sec: Number(process.env.UPTIME_SEC ?? 0),
});

const client = mqtt.connect(url);

client.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});

client.on('connect', () => {
  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error(err.message);
      process.exit(1);
    }
    console.log(`published qos1 ${topic}`, payload);
    client.end();
  });
});
