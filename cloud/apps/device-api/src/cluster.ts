/**
 * 可选多进程入口：利用多核跑多个 `device-api` 实例（各进程独立端口需由外部分配）。
 * GitHub #13：先 cluster，再水平多机 + BullMQ 队列。
 *
 * 使用：`DEVICE_API_CLUSTER_WORKERS=4 npm run start:cluster`
 * 未设置或 `0` 时退化为单进程 {@link bootstrap}。
 */
import cluster from 'node:cluster';
import * as os from 'node:os';
import { bootstrap } from './nest-bootstrap';

const raw = (process.env.DEVICE_API_CLUSTER_WORKERS ?? '0').trim();
const requested = Number.parseInt(raw, 10);
const cpus = os.availableParallelism();
const count =
  Number.isFinite(requested) && requested > 0
    ? Math.min(requested, Math.max(1, cpus))
    : 0;

if (count > 0 && cluster.isPrimary) {
  // eslint-disable-next-line no-console
  console.log(
    `[cluster] primary pid=${process.pid} forking ${count} worker(s) (cpus=${cpus})`,
  );
  for (let i = 0; i < count; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    // eslint-disable-next-line no-console
    console.warn(
      `[cluster] worker ${worker.process.pid} exit code=${code} signal=${signal ?? ''}`,
    );
  });
} else {
  void bootstrap().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
