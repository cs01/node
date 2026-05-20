// worker_threads module — stub for test/common compatibility
'use strict';
module.exports = {
  isMainThread: true,
  parentPort: null,
  workerData: null,
  threadId: 0,
  Worker: class Worker { constructor() { throw new Error('worker_threads not implemented'); } },
};
