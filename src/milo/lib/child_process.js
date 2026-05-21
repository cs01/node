// child_process module — real process spawning via posix_spawn
'use strict';

const EventEmitter = require('events');
const b = internalBinding('spawn');

function normalizeArgs(cmd, args, opts) {
  if (typeof args === 'object' && !Array.isArray(args)) { opts = args; args = []; }
  return { args: args || [], opts: opts || {} };
}

function spawnSync(file, args, options) {
  const { args: a, opts } = normalizeArgs(file, args, options);
  const allArgs = a;
  const input = opts.input != null ? String(opts.input) : undefined;
  const result = b.spawnSync(file, allArgs, input);
  if (result.error) {
    return { status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: new Error('spawn ' + file + ' failed') };
  }
  const encoding = opts.encoding || 'buffer';
  let stdout = result.stdout || '';
  let stderr = result.stderr || '';
  if (encoding === 'buffer') {
    stdout = Buffer.from(stdout);
    stderr = Buffer.from(stderr);
  }
  return { status: result.status, signal: null, stdout, stderr, error: null };
}

function execSync(command, options) {
  const opts = options || {};
  const result = spawnSync('/bin/sh', ['-c', command], opts);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = new Error('Command failed: ' + command + '\n' + (result.stderr ? result.stderr.toString() : ''));
    err.status = result.status;
    err.stdout = result.stdout;
    err.stderr = result.stderr;
    throw err;
  }
  const encoding = opts.encoding || 'buffer';
  return encoding === 'buffer' ? result.stdout : result.stdout.toString(encoding);
}

function execFileSync(file, args, options) {
  const { args: a, opts } = normalizeArgs(file, args, options);
  const result = spawnSync(file, a, opts);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = new Error('Command failed: ' + file);
    err.status = result.status;
    err.stdout = result.stdout;
    err.stderr = result.stderr;
    throw err;
  }
  const encoding = opts.encoding || 'buffer';
  return encoding === 'buffer' ? result.stdout : result.stdout.toString(encoding);
}

// Async spawn — runs spawnSync in current tick then emits events
// True async would need the event loop to poll child — this is good enough for most uses
function spawn(file, args, options) {
  const { args: a, opts } = normalizeArgs(file, args, options);
  const child = new EventEmitter();
  const { Readable, Writable } = require('stream');

  child.stdin = new Writable({ write(chunk, enc, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.pid = 0;
  child.killed = false;
  child.kill = function() { child.killed = true; };

  process.nextTick(() => {
    const stdinChunks = [];
    const origWrite = child.stdin._write;
    child.stdin._write = function(chunk, enc, cb) { stdinChunks.push(chunk); cb(); };

    process.nextTick(() => {
      const input = stdinChunks.length > 0 ? Buffer.concat(stdinChunks).toString() : undefined;
      const result = b.spawnSync(file, a, input);

      if (result.error) {
        child.emit('error', new Error('spawn ' + file + ' failed'));
        return;
      }

      if (result.stdout) {
        child.stdout.push(Buffer.from(result.stdout));
      }
      child.stdout.push(null);

      if (result.stderr) {
        child.stderr.push(Buffer.from(result.stderr));
      }
      child.stderr.push(null);

      child.exitCode = result.status;
      child.emit('close', result.status, null);
    });
  });

  return child;
}

function exec(command, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  const opts = options || {};
  const child = spawn('/bin/sh', ['-c', command], opts);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('close', (code) => {
    if (cb) {
      if (code !== 0) {
        const err = new Error('Command failed: ' + command);
        err.code = code;
        cb(err, stdout, stderr);
      } else {
        cb(null, stdout, stderr);
      }
    }
  });
  child.on('error', (err) => { if (cb) cb(err, stdout, stderr); });
  return child;
}

function execFile(file, args, options, cb) {
  if (typeof args === 'function') { cb = args; args = []; options = {}; }
  if (typeof options === 'function') { cb = options; options = {}; }
  const opts = options || {};
  const child = spawn(file, args || [], opts);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('close', (code) => {
    if (cb) {
      if (code !== 0) {
        const err = new Error('Command failed: ' + file);
        err.code = code;
        cb(err, stdout, stderr);
      } else {
        cb(null, stdout, stderr);
      }
    }
  });
  child.on('error', (err) => { if (cb) cb(err, stdout, stderr); });
  return child;
}

function fork() {
  throw new Error('child_process.fork() not supported in milo-node');
}

module.exports = {
  spawnSync,
  execSync,
  execFileSync,
  spawn,
  exec,
  execFile,
  fork,
};
