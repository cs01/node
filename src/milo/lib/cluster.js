// cluster module — fork-based cluster with IPC messaging
'use strict';

const EventEmitter = require('events');
const { fork: cpFork } = require('child_process');
const path = require('path');

const cluster = new EventEmitter();

cluster.isPrimary = true;
cluster.isMaster = true;
cluster.isWorker = false;
cluster.workers = {};
cluster.settings = {};
cluster.SCHED_NONE = 1;
cluster.SCHED_RR = 2;
cluster.schedulingPolicy = cluster.SCHED_RR;

let nextWorkerId = 1;

class Worker extends EventEmitter {
  constructor(id, process) {
    super();
    this.id = id;
    this.process = process;
    this.exitedAfterDisconnect = false;
    this.state = 'online';
    this.isDead = () => this.state === 'dead';
    this.isConnected = () => this.state !== 'dead' && this.state !== 'disconnected';
  }
  send(msg, handle, options, cb) {
    if (typeof options === 'function') { cb = options; options = undefined; }
    if (this.process && this.process.send) {
      this.process.send(msg, handle, options, cb);
    }
    return this;
  }
  kill(signal) { this.destroy(signal); }
  destroy(signal) {
    if (this.process) this.process.kill(signal || 'SIGTERM');
  }
  disconnect() {
    this.exitedAfterDisconnect = true;
    if (this.process && this.process.disconnect) this.process.disconnect();
    this.state = 'disconnected';
    this.emit('disconnect');
    return this;
  }
}

cluster.Worker = Worker;

cluster.setupPrimary = function(opts) {
  Object.assign(cluster.settings, {
    exec: opts && opts.exec || process.argv[1],
    args: opts && opts.args || process.argv.slice(2),
    execArgv: opts && opts.execArgv || process.execArgv || [],
    cwd: opts && opts.cwd || undefined,
    silent: opts && opts.silent || false,
  }, opts);
  cluster.emit('setup', cluster.settings);
};
cluster.setupMaster = cluster.setupPrimary;

cluster.fork = function(env) {
  if (!cluster.settings.exec) {
    cluster.setupPrimary();
  }
  const id = nextWorkerId++;
  const stdio = cluster.settings.silent ? ['pipe', 'pipe', 'pipe', 'ipc'] : [0, 1, 2, 'ipc'];
  const child = cpFork(cluster.settings.exec, cluster.settings.args || [], {
    env: Object.assign({}, process.env, env, { NODE_UNIQUE_ID: String(id) }),
    execArgv: cluster.settings.execArgv,
    cwd: cluster.settings.cwd,
    stdio,
  });
  const worker = new Worker(id, child);
  cluster.workers[id] = worker;
  child.on('message', (msg) => {
    worker.emit('message', msg);
    cluster.emit('message', worker, msg);
  });
  child.on('exit', (code, signal) => {
    worker.state = 'dead';
    delete cluster.workers[id];
    worker.emit('exit', code, signal);
    cluster.emit('exit', worker, code, signal);
  });
  child.on('error', (err) => {
    worker.emit('error', err);
  });
  process.nextTick(() => {
    worker.emit('online');
    cluster.emit('online', worker);
  });
  return worker;
};

cluster.disconnect = function(cb) {
  const workers = Object.values(cluster.workers);
  let remaining = workers.length;
  if (remaining === 0 && cb) { process.nextTick(cb); return; }
  for (const w of workers) {
    w.disconnect();
    w.once('disconnect', () => {
      if (--remaining === 0 && cb) cb();
    });
  }
};

// When loaded in a worker process (NODE_UNIQUE_ID is set)
if (process.env.NODE_UNIQUE_ID) {
  cluster.isPrimary = false;
  cluster.isMaster = false;
  cluster.isWorker = true;
  cluster.worker = { id: parseInt(process.env.NODE_UNIQUE_ID) };
}

module.exports = cluster;
