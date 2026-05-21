// child_process module — real process spawning via posix_spawn
'use strict';

const EventEmitter = require('events');
const b = internalBinding('spawn');

function normalizeArgs(cmd, args, opts) {
  if (typeof args === 'object' && !Array.isArray(args)) { opts = args; args = []; }
  return { args: args || [], opts: opts || {} };
}

// 0=pipe, 1=inherit, 2=ignore
function parseStdioMode(val) {
  if (val === 'pipe' || val === undefined || val === null) return 0;
  if (val === 'inherit') return 1;
  if (val === 'ignore') return 2;
  if (typeof val === 'number') return 1; // fd number = inherit-like
  return 0;
}

function parseStdio(opts) {
  const stdio = opts.stdio;
  if (!stdio) return [0, 0, 0];
  if (typeof stdio === 'string') {
    const m = parseStdioMode(stdio);
    return [m, m, m];
  }
  if (Array.isArray(stdio)) {
    return [parseStdioMode(stdio[0]), parseStdioMode(stdio[1]), parseStdioMode(stdio[2])];
  }
  return [0, 0, 0];
}

function spawnSync(file, args, options) {
  const { args: a, opts } = normalizeArgs(file, args, options);
  const allArgs = a;
  const input = opts.input != null ? String(opts.input) : undefined;
  const [stdinMode, stdoutMode, stderrMode] = parseStdio(opts);
  const result = b.spawnSync(file, allArgs, input, stdinMode, stdoutMode, stderrMode);
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
  const [stdinMode, stdoutMode, stderrMode] = parseStdio(opts);
  const child = new EventEmitter();
  const { Readable, Writable } = require('stream');

  child.stdin = stdinMode === 0 ? new Writable({ write(chunk, enc, cb) { cb(); } }) : null;
  child.stdout = stdoutMode === 0 ? new Readable({ read() {} }) : null;
  child.stderr = stderrMode === 0 ? new Readable({ read() {} }) : null;
  child.pid = 0;
  child.killed = false;
  child.kill = function() { child.killed = true; };

  process.nextTick(() => {
    const stdinChunks = [];
    if (child.stdin) {
      child.stdin._write = function(chunk, enc, cb) { stdinChunks.push(chunk); cb(); };
    }

    process.nextTick(() => {
      const input = stdinChunks.length > 0 ? Buffer.concat(stdinChunks).toString() : undefined;
      const result = b.spawnSync(file, a, input, stdinMode, stdoutMode, stderrMode);

      if (result.error) {
        child.emit('error', new Error('spawn ' + file + ' failed'));
        return;
      }

      if (child.stdout) {
        if (result.stdout) child.stdout.push(Buffer.from(result.stdout));
        child.stdout.push(null);
      }

      if (child.stderr) {
        if (result.stderr) child.stderr.push(Buffer.from(result.stderr));
        child.stderr.push(null);
      }

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
