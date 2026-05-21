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

// True async spawn — pipes registered with kqueue for non-blocking I/O
function spawn(file, args, options) {
  const { args: a, opts } = normalizeArgs(file, args, options);
  const [stdinMode, stdoutMode, stderrMode] = parseStdio(opts);
  const child = new EventEmitter();
  const { Readable, Writable } = require('stream');
  const net = require('net');
  const tcp = internalBinding('tcp');

  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.connected = false;

  const result = b.spawnAsync(file, a, stdinMode, stdoutMode, stderrMode);
  if (!result || result === -1) {
    child.pid = 0;
    child.stdin = null;
    child.stdout = null;
    child.stderr = null;
    process.nextTick(() => child.emit('error', new Error('spawn ' + file + ' ENOENT')));
    return child;
  }

  child.pid = result.pid;
  let pipesOpen = 0;

  // Writable stdin pipe
  if (result.stdinFd >= 0) {
    child.stdin = new Writable({
      write(chunk, enc, cb) {
        const str = typeof chunk === 'string' ? chunk : chunk.toString();
        b.writePipe(result.stdinFd, str);
        cb();
      },
      final(cb) {
        b.closeFd(result.stdinFd);
        cb();
      }
    });
  } else {
    child.stdin = null;
  }

  // Register pipe fds with kqueue for async reads
  function setupReadPipe(fd) {
    if (fd < 0) return null;
    pipesOpen++;
    const stream = new Readable({ read() {} });
    net._ensurePoll();

    const pipeObj = {
      _fd: fd,
      destroyed: false,
      _onReadable() {
        for (;;) {
          const data = b.readPipe(fd);
          if (data === undefined) {
            stream.push(null);
            net.Socket._sockets.delete(fd);
            b.closeFd(fd);
            this.destroyed = true;
            pipesOpen--;
            _checkExit();
            return;
          }
          if (data.length === 0) break;
          stream.push(Buffer.from(data));
        }
      }
    };

    net.Socket._sockets.set(fd, pipeObj);
    tcp.pollAdd(fd, tcp.EVFILT_READ);
    return stream;
  }

  child.stdout = setupReadPipe(result.stdoutFd);
  child.stderr = setupReadPipe(result.stderrFd);

  child.kill = function(signal) {
    if (child.killed) return false;
    const sig = typeof signal === 'string' ? { SIGTERM: 15, SIGKILL: 9, SIGINT: 2, SIGHUP: 1 }[signal] || 15 : (signal || 15);
    b.killPid(child.pid, sig);
    child.killed = true;
    return true;
  };

  function _checkExit() {
    if (pipesOpen > 0) return;
    // All pipes closed — poll for exit status
    const _poll = () => {
      const status = b.waitpidNH(child.pid);
      if (status === -1) {
        setTimeout(_poll, 10);
        return;
      }
      child.exitCode = status;
      child.emit('exit', status, null);
      child.emit('close', status, null);
    };
    _poll();
  }

  // No pipes to wait on — go straight to exit polling
  if (pipesOpen === 0) {
    process.nextTick(_checkExit);
  }

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
