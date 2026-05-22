'use strict';
/** 与 `PIPELINE_WORKER_STANDALONE=1 node dist/main.js` 等价（跨 shell 设置 env）。 */
process.env.PIPELINE_WORKER_STANDALONE = '1';
require('../dist/main.js');
