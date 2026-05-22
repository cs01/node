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
    const err = new Error('spawnSync ' + file + ' ENOENT');
    err.code = 'ENOENT';
    err.errno = -2;
    err.syscall = 'spawnSync ' + file;
    err.path = file;
    return { status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: err };
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

function fork(modulePath, args, options) {
  if (Array.isArray(args)) { options = options || {}; }
  else if (args && typeof args === 'object' && !Array.isArray(args)) { options = args; args = []; }
  else { args = args || []; options = options || {}; }

  const net = require('net');
  const tcp = internalBinding('tcp');
  const spawnBinding = internalBinding('spawn');

  // Create Unix domain socket pair for IPC
  const pair = spawnBinding.socketpair();
  if (!pair || pair === -1) throw new Error('socketpair() failed');
  const parentFd = pair[0];
  const childFd = pair[1];

  // Resolve the execPath (use current process executable)
  const execPath = options.execPath || process.execPath || './out/Release/milo-node';
  let execArgv = options.execArgv || process.execArgv || [];

  // Fork bomb protection: strip -e/--eval from execArgv so child doesn't re-run eval
  if (process._eval != null) {
    const filtered = [];
    for (let i = 0; i < execArgv.length; i++) {
      if (execArgv[i] === '-e' || execArgv[i] === '--eval' || execArgv[i] === '-p' || execArgv[i] === '--print') {
        i++; // skip the value arg too
      } else {
        filtered.push(execArgv[i]);
      }
    }
    execArgv = filtered;
  }

  // Build spawn args: execArgv + modulePath + args
  const spawnArgs = [...execArgv, modulePath, ...args];
  const { Readable, Writable } = require('stream');

  // Set environment for child — must include NODE_CHANNEL_FD and any custom env
  const savedEnv = {};
  const childEnv = options.env || {};
  const envKeys = Object.keys(childEnv);
  for (const k of envKeys) { savedEnv[k] = process.env[k]; process.env[k] = childEnv[k]; }
  const hadChannelFd = process.env.NODE_CHANNEL_FD;
  process.env.NODE_CHANNEL_FD = '3';
  // fork() defaults to inherit unless silent:true or explicit stdio
  const forkOpts = options.stdio ? options : (options.silent ? { stdio: ['pipe', 'pipe', 'pipe'] } : { stdio: ['inherit', 'inherit', 'inherit'] });
  const [stdinMode, stdoutMode, stderrMode] = parseStdio(forkOpts);
  const result = spawnBinding.spawnAsync(execPath, spawnArgs, stdinMode, stdoutMode, stderrMode, childFd);
  // Restore parent env
  if (hadChannelFd !== undefined) process.env.NODE_CHANNEL_FD = hadChannelFd;
  else delete process.env.NODE_CHANNEL_FD;
  for (const k of envKeys) {
    if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
    else delete process.env[k];
  }

  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.connected = true;
  child.channel = {};

  if (!result || result === -1) {
    child.pid = 0;
    child.stdin = null;
    child.stdout = null;
    child.stderr = null;
    process.nextTick(() => child.emit('error', new Error('fork ' + modulePath + ' failed')));
    return child;
  }

  child.pid = result.pid;
  let pipesOpen = 0;

  // Setup stdin
  if (result.stdinFd >= 0) {
    child.stdin = new Writable({
      write(chunk, enc, cb) {
        spawnBinding.writePipe(result.stdinFd, typeof chunk === 'string' ? chunk : chunk.toString());
        cb();
      },
      final(cb) { spawnBinding.closeFd(result.stdinFd); cb(); }
    });
  } else { child.stdin = null; }

  // Setup stdout/stderr pipes
  function setupReadPipe(fd) {
    if (fd < 0) return null;
    pipesOpen++;
    const stream = new Readable({ read() {} });
    net._ensurePoll();
    const pipeObj = {
      _fd: fd, destroyed: false,
      _onReadable() {
        for (;;) {
          const data = spawnBinding.readPipe(fd);
          if (data === undefined) {
            stream.push(null);
            net.Socket._sockets.delete(fd);
            spawnBinding.closeFd(fd);
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

  // IPC message channel over parentFd — newline-delimited JSON
  net._ensurePoll();
  spawnBinding.setNonBlocking(parentFd);

  let ipcBuf = '';
  const ipcObj = {
    _fd: parentFd, destroyed: false, _unref: true,
    _onReadable() {
      for (;;) {
        const data = spawnBinding.readPipe(parentFd);
        if (data === undefined) {
          // IPC channel closed
          net.Socket._sockets.delete(parentFd);
          spawnBinding.closeFd(parentFd);
          this.destroyed = true;
          child.connected = false;
          child.emit('disconnect');
          return;
        }
        if (data.length === 0) break;
        ipcBuf += data.replace(/\0/g, '');
        let nl;
        while ((nl = ipcBuf.indexOf('\n')) >= 0) {
          const line = ipcBuf.substring(0, nl);
          ipcBuf = ipcBuf.substring(nl + 1);
          if (line.length > 0) {
            try { child.emit('message', JSON.parse(line)); } catch {}
          }
        }
      }
    }
  };
  net.Socket._sockets.set(parentFd, ipcObj);
  tcp.pollAdd(parentFd, tcp.EVFILT_READ);

  child.send = function(message, sendHandle, options, callback) {
    if (typeof sendHandle === 'function') { callback = sendHandle; sendHandle = undefined; }
    if (typeof options === 'function') { callback = options; options = undefined; }
    if (!child.connected) { if (callback) callback(new Error('channel closed')); return false; }
    const data = JSON.stringify(message) + '\n';
    spawnBinding.writePipe(parentFd, data);
    if (callback) process.nextTick(callback);
    return true;
  };

  child.disconnect = function() {
    if (!child.connected) return;
    child.connected = false;
    net.Socket._sockets.delete(parentFd);
    spawnBinding.closeFd(parentFd);
    child.emit('disconnect');
  };

  child.kill = function(signal) {
    if (child.killed) return false;
    const sig = typeof signal === 'string' ? { SIGTERM: 15, SIGKILL: 9, SIGINT: 2, SIGHUP: 1 }[signal] || 15 : (signal || 15);
    spawnBinding.killPid(child.pid, sig);
    child.killed = true;
    return true;
  };

  function _checkExit() {
    if (pipesOpen > 0) return;
    const _poll = () => {
      const status = spawnBinding.waitpidNH(child.pid);
      if (status === -1) { setTimeout(_poll, 10); return; }
      child.exitCode = status;
      if (child.connected) child.disconnect();
      child.emit('exit', status, null);
      child.emit('close', status, null);
    };
    _poll();
  }

  if (pipesOpen === 0) process.nextTick(_checkExit);
  return child;
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
