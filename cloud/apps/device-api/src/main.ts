import { bootstrap, runPipelineWorkerStandalone } from './nest-bootstrap';

const standalone = ['1', 'true', 'yes'].includes(
  (process.env.PIPELINE_WORKER_STANDALONE ?? '').toLowerCase(),
);

if (standalone) {
  void runPipelineWorkerStandalone().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
} else {
  void bootstrap().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
