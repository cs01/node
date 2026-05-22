// worker_threads module — stub with MessageChannel/MessagePort from globals
'use strict';
module.exports = {
  isMainThread: true,
  parentPort: null,
  workerData: null,
  threadId: 0,
  Worker: class Worker { constructor() { throw new Error('worker_threads not implemented'); } },
  MessageChannel: globalThis.MessageChannel,
  MessagePort: globalThis.MessagePort,
  BroadcastChannel: globalThis.BroadcastChannel,
  receiveMessageOnPort: function(port) { return undefined; },
  markAsUntransferable: function() {},
  moveMessagePortToContext: function() { throw new Error('Not implemented'); },
  SHARE_ENV: Symbol('nodejs.worker_threads.SHARE_ENV'),
  resourceLimits: {},
  setEnvironmentData: function() {},
  getEnvironmentData: function() { return undefined; },
};
