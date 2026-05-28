// child_process module — real process spawning via posix_spawn
'use strict';

const EventEmitter = require('events');
const b = internalBinding('spawn');

// Fork bomb guard: track spawn depth, kill if too deep
const _SPAWN_DEPTH = parseInt(process.env._MILO_SPAWN_DEPTH || '0', 10);
const _MAX_SPAWN_DEPTH = 8;

// Signal name → number (darwin values, matching the kernel's wait-status codes).
const _SIGNAL_NUM = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6, SIGEMT: 7, SIGFPE: 8, SIGKILL: 9, SIGBUS: 10, SIGSEGV: 11, SIGSYS: 12, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15, SIGURG: 16, SIGSTOP: 17, SIGTSTP: 18, SIGCONT: 19, SIGCHLD: 20, SIGTTIN: 21, SIGTTOU: 22, SIGIO: 23, SIGXCPU: 24, SIGXFSZ: 25, SIGVTALRM: 26, SIGPROF: 27, SIGWINCH: 28, SIGINFO: 29, SIGUSR1: 30, SIGUSR2: 31 };
const _SIGNAL_NAME = {};
for (const name of Object.keys(_SIGNAL_NUM)) _SIGNAL_NAME[_SIGNAL_NUM[name]] = name;

function _signalToNum(signal) {
  // Signal 0 is the liveness-probe no-op — must not collapse to SIGTERM.
  if (signal === 0) return 0;
  if (signal === undefined || signal === null) return 15;
  return typeof signal === 'string' ? (_SIGNAL_NUM[signal] || 15) : signal;
}

function _validateFile(file) {
  if (typeof file !== 'string') {
    const e = new TypeError(`The "file" argument must be of type string. Received ${_fmtReceived(file)}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
}
function normalizeArgs(cmd, args, opts) {
  _validateFile(cmd);
  if (typeof args === 'object' && !Array.isArray(args)) { opts = args; args = []; }
  const a = (args || []).map(arg => typeof arg === 'string' ? arg : String(arg));
  return { args: a, opts: opts || {} };
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

function _injectDepth(opts) {
  const env = opts.env ? { ...opts.env } : { ...process.env };
  env._MILO_SPAWN_DEPTH = String(_SPAWN_DEPTH + 1);
  return env;
}

function _fmtReceived(v) {
  if (v === null) return 'null';
  if (typeof v === 'symbol') return 'type symbol (' + v.toString() + ')';
  if (typeof v === 'object') return 'an instance of ' + ((v.constructor && v.constructor.name) || 'Object');
  if (typeof v === 'string') return "type string ('" + v + "')";
  return 'type ' + typeof v + ' (' + v + ')';
}
function _validateSpawnOpts(opts) {
  if (opts.cwd != null && typeof opts.cwd !== 'string' && !(opts.cwd instanceof URL)) {
    const e = new TypeError(`The "options.cwd" property must be of type string or an instance of URL. Received ${_fmtReceived(opts.cwd)}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (opts.detached != null && typeof opts.detached !== 'boolean') {
    const e = new TypeError(`The "options.detached" property must be of type boolean. Received ${_fmtReceived(opts.detached)}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (opts.uid != null) {
    if (typeof opts.uid !== 'number') {
      const e = new TypeError(`The "options.uid" property must be of type number. Received ${_fmtReceived(opts.uid)}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (!Number.isInteger(opts.uid) || opts.uid < 0) {
      const e = new RangeError(`The value of "options.uid" is out of range. It must be a positive integer. Received ${opts.uid}`);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
  }
  if (opts.gid != null) {
    if (typeof opts.gid !== 'number') {
      const e = new TypeError(`The "options.gid" property must be of type number. Received ${_fmtReceived(opts.gid)}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (!Number.isInteger(opts.gid) || opts.gid < 0) {
      const e = new RangeError(`The value of "options.gid" is out of range. It must be a positive integer. Received ${opts.gid}`);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
  }
  if (opts.maxBuffer != null) {
    if (typeof opts.maxBuffer !== 'number') {
      const e = new TypeError(`The "options.maxBuffer" property must be of type number. Received ${_fmtReceived(opts.maxBuffer)}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (opts.maxBuffer < 0) {
      const e = new RangeError(`The value of "options.maxBuffer" is out of range. It must be a positive number. Received ${opts.maxBuffer}`);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
  }
  if (opts.shell != null && typeof opts.shell !== 'boolean' && typeof opts.shell !== 'string') {
    const e = new TypeError(`The "options.shell" property must be of type boolean or string. Received ${_fmtReceived(opts.shell)}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (opts.argv0 != null && typeof opts.argv0 !== 'string') {
    const e = new TypeError(`The "options.argv0" property must be of type string. Received ${_fmtReceived(opts.argv0)}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (opts.windowsHide != null && typeof opts.windowsHide !== 'boolean') {
    const e = new TypeError(`The "options.windowsHide" property must be of type boolean. Received ${_fmtReceived(opts.windowsHide)}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (opts.windowsVerbatimArguments != null && typeof opts.windowsVerbatimArguments !== 'boolean') {
    const e = new TypeError(`The "options.windowsVerbatimArguments" property must be of type boolean. Received ${_fmtReceived(opts.windowsVerbatimArguments)}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (opts.timeout != null) {
    if (typeof opts.timeout !== 'number') {
      const e = new TypeError(`The "options.timeout" property must be of type number. Received ${_fmtReceived(opts.timeout)}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (!Number.isInteger(opts.timeout) || opts.timeout < 0) {
      const e = new RangeError(`The value of "options.timeout" is out of range. It must be a non-negative integer. Received ${opts.timeout}`);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
  }
  if (opts.killSignal != null) {
    if (typeof opts.killSignal !== 'string' && typeof opts.killSignal !== 'number') {
      const e = new TypeError(`The "options.killSignal" property must be one of type string or number. Received ${_fmtReceived(opts.killSignal)}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (typeof opts.killSignal === 'string') {
      const os = require('os');
      const sigs = os.constants && os.constants.signals;
      if (sigs && !Object.prototype.hasOwnProperty.call(sigs, opts.killSignal) && !Object.prototype.hasOwnProperty.call(sigs, opts.killSignal.toUpperCase())) {
        const e = new TypeError(`Unknown signal: ${opts.killSignal}`);
        e.code = 'ERR_UNKNOWN_SIGNAL'; throw e;
      }
    } else if (typeof opts.killSignal === 'number') {
      const os = require('os');
      const sigs = os.constants && os.constants.signals;
      const validNums = sigs ? new Set(Object.values(sigs)) : new Set();
      if (!validNums.has(opts.killSignal)) {
        const e = new TypeError(`Unknown signal: ${opts.killSignal}`);
        e.code = 'ERR_UNKNOWN_SIGNAL'; throw e;
      }
    }
  }
}
function spawnSync(file, args, options) {
  const { args: a, opts } = normalizeArgs(file, args, options);
  _validateSpawnOpts(opts);
  if (_SPAWN_DEPTH >= _MAX_SPAWN_DEPTH) {
    return { status: 1, signal: null, stdout: '', stderr: 'spawn depth exceeded\n', error: new Error('spawn depth limit exceeded') };
  }
  // Save and set env (native spawnSync inherits process.env)
  const savedEnv = {};
  const addedKeys = [];
  if (opts.env) {
    for (const k of Object.keys(opts.env)) {
      if (k in process.env) savedEnv[k] = process.env[k];
      else addedKeys.push(k);
      process.env[k] = opts.env[k];
    }
  }
  const savedDepth = process.env._MILO_SPAWN_DEPTH;
  process.env._MILO_SPAWN_DEPTH = String(_SPAWN_DEPTH + 1);
  // Handle cwd by chdir (restore after)
  let savedCwd;
  if (opts.cwd) { try { savedCwd = process.cwd(); process.chdir(String(opts.cwd)); } catch {} }
  const input = opts.input != null ? String(opts.input) : undefined;
  const [stdinMode, stdoutMode, stderrMode] = parseStdio(opts);
  let result;
  try { result = b.spawnSync(file, a, input, stdinMode, stdoutMode, stderrMode); }
  finally {
    if (savedDepth !== undefined) process.env._MILO_SPAWN_DEPTH = savedDepth; else delete process.env._MILO_SPAWN_DEPTH;
    if (opts.env) { for (const k of Object.keys(savedEnv)) process.env[k] = savedEnv[k]; for (const k of addedKeys) delete process.env[k]; }
    if (savedCwd) { try { process.chdir(savedCwd); } catch {} }
  }
  if (result.error) {
    const err = new Error('spawnSync ' + file + ' ENOENT');
    err.code = 'ENOENT';
    err.errno = -2;
    err.syscall = 'spawnSync ' + file;
    err.path = file;
    err.spawnargs = a;
    return { status: null, signal: null, output: [null, Buffer.alloc(0), Buffer.alloc(0)], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: err, pid: 0 };
  }
  const encoding = opts.encoding || 'buffer';
  let stdout = result.stdout || '';
  let stderr = result.stderr || '';
  if (encoding === 'buffer') {
    stdout = Buffer.from(stdout);
    stderr = Buffer.from(stderr);
  }
  const signal = result.signal == null ? null : (_SIGNAL_NAME[result.signal] || null);
  return { status: result.status, signal, output: [null, stdout, stderr], stdout, stderr, pid: result.pid || 0 };
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
  _validateSpawnOpts(opts);
  const [stdinMode, stdoutMode, stderrMode] = parseStdio(opts);
  const child = new EventEmitter();
  const { Readable, Writable } = require('stream');
  const net = require('net');
  const tcp = internalBinding('tcp');

  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.connected = false;

  function _deadChild() {
    child.stdin = new Writable({ write(c, e, cb) { cb(); }, final(cb) { cb(); } });
    child.stdout = new Readable({ read() { this.push(null); } });
    child.stderr = new Readable({ read() { this.push(null); } });
    child.kill = () => false;
    child.ref = () => child;
    child.unref = () => child;
  }

  if (_SPAWN_DEPTH >= _MAX_SPAWN_DEPTH) {
    child.pid = 0; _deadChild();
    process.nextTick(() => child.emit('error', new Error('spawn depth limit exceeded')));
    return child;
  }

  const result = b.spawnAsync(file, a, stdinMode, stdoutMode, stderrMode);
  if (!result || result === -1) {
    _deadChild();
    child.spawnfile = file; child.spawnargs = [file, ...a];
    const err = new Error('spawn ' + file + ' ENOENT');
    err.code = 'ENOENT'; err.syscall = 'spawn ' + file; err.path = file; err.spawnargs = a;
    process.nextTick(() => child.emit('error', err));
    return child;
  }

  child.pid = result.pid;
  child.spawnfile = file;
  child.spawnargs = [file, ...a];
  process.nextTick(() => child.emit('spawn'));
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
            process.nextTick(() => stream.emit('close'));
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
    const sig = _signalToNum(signal);
    b.killPid(child.pid, sig);
    child.killed = true;
    return true;
  };

  function _checkExit() {
    if (pipesOpen > 0) return;
    // All pipes closed — poll for exit status
    const _poll = () => {
      const status = b.waitpidNH(child.pid);
      if (status === undefined) {
        setTimeout(_poll, 10);
        return;
      }
      const signal = status.signal == null ? null : (_SIGNAL_NAME[status.signal] || null);
      const code = signal == null ? status.code : null;
      child.exitCode = code;
      child.signalCode = signal;
      child.emit('exit', code, signal);
      child.emit('close', code, signal);
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
  const enc = opts.encoding !== undefined ? opts.encoding : 'utf8';
  const child = spawn('/bin/sh', ['-c', command], opts);
  let stdout = '';
  let stderr = '';
  if (enc && child.stdout) child.stdout.setEncoding(enc);
  if (enc && child.stderr) child.stderr.setEncoding(enc);
  if (child.stdout) child.stdout.on('data', (d) => { stdout += typeof d === 'string' ? d : d.toString(); });
  if (child.stderr) child.stderr.on('data', (d) => { stderr += typeof d === 'string' ? d : d.toString(); });
  child.on('close', (code) => {
    if (cb) {
      if (code !== 0) {
        const err = new Error('Command failed: ' + command);
        err.code = code;
        err.cmd = command;
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
  const enc = opts.encoding !== undefined ? opts.encoding : 'utf8';
  const child = spawn(file, args || [], opts);
  let stdout = '';
  let stderr = '';
  if (enc && child.stdout) child.stdout.setEncoding(enc);
  if (enc && child.stderr) child.stderr.setEncoding(enc);
  if (child.stdout) child.stdout.on('data', (d) => { stdout += typeof d === 'string' ? d : d.toString(); });
  if (child.stderr) child.stderr.on('data', (d) => { stderr += typeof d === 'string' ? d : d.toString(); });
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
  child.on('error', (err) => { err.cmd = file + (args && args.length ? ' ' + args.join(' ') : ''); if (cb) cb(err, stdout, stderr); });
  return child;
}

function fork(modulePath, args, options) {
  if (typeof modulePath !== 'string') {
    const e = new TypeError(`The "modulePath" argument must be of type string or an instance of URL. Received ${_fmtReceived(modulePath)}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
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
    const sig = _signalToNum(signal);
    spawnBinding.killPid(child.pid, sig);
    child.killed = true;
    return true;
  };

  function _checkExit() {
    if (pipesOpen > 0) return;
    const _poll = () => {
      const status = spawnBinding.waitpidNH(child.pid);
      if (status === undefined) { setTimeout(_poll, 10); return; }
      const signal = status.signal == null ? null : (_SIGNAL_NAME[status.signal] || null);
      const code = signal == null ? status.code : null;
      child.exitCode = code;
      child.signalCode = signal;
      if (child.connected) child.disconnect();
      child.emit('exit', code, signal);
      child.emit('close', code, signal);
    };
    _poll();
  }

  if (pipesOpen === 0) process.nextTick(_checkExit);
  return child;
}

// Matches test/common's invalidArgTypeHelper so thrown messages line up exactly.
function _invalidArgTypeHelper(input) {
  if (input == null) return ` Received ${input}`;
  if (typeof input === 'function') return ` Received function ${input.name}`;
  const { inspect } = require('util');
  if (typeof input === 'object') {
    if (input.constructor && input.constructor.name) return ` Received an instance of ${input.constructor.name}`;
    return ` Received ${inspect(input, { depth: -1 })}`;
  }
  let inspected = inspect(input, { colors: false });
  if (inspected.length > 28) inspected = `${inspected.slice(0, 25)}...`;
  return ` Received type ${typeof input} (${inspected})`;
}

// Low-level ChildProcess class (public API surface). spawn()/fork() above are
// the high-level factories; this exposes the constructor + validating .spawn().
class ChildProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = undefined;
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    this.spawnfile = undefined;
    this.spawnargs = undefined;
    this.stdin = null; this.stdout = null; this.stderr = null;
    this.stdio = [null, null, null];
    this.connected = false;
  }

  // Validation order (options → envPairs → file → args) matches Node: the
  // envPairs check must precede file so an absent file doesn't mask it.
  spawn(options) {
    if (options === null || typeof options !== 'object') {
      const e = new TypeError(`The "options" argument must be of type object.${_invalidArgTypeHelper(options)}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (options.envPairs !== undefined && !Array.isArray(options.envPairs)) {
      const e = new TypeError(`The "options.envPairs" property must be an instance of Array.${_invalidArgTypeHelper(options.envPairs)}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (typeof options.file !== 'string') {
      const e = new TypeError(`The "options.file" property must be of type string.${_invalidArgTypeHelper(options.file)}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (options.args !== undefined && !Array.isArray(options.args)) {
      const e = new TypeError(`The "options.args" property must be an instance of Array.${_invalidArgTypeHelper(options.args)}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    this.spawnfile = options.file;
    const args = options.args || [];
    this.spawnargs = args;
    const [stdinMode, stdoutMode, stderrMode] = parseStdio({ stdio: options.stdio });
    const result = b.spawnAsync(options.file, args, stdinMode, stdoutMode, stderrMode);
    this.pid = (result && result !== -1) ? result.pid : 0;
    return this;
  }

  kill(signal) {
    if (this.killed) return false;
    if (typeof signal === 'string' && !Object.prototype.hasOwnProperty.call(_SIGNAL_NUM, signal)) {
      const e = new TypeError(`Unknown signal: ${signal}`); e.code = 'ERR_UNKNOWN_SIGNAL'; throw e;
    }
    const sig = _signalToNum(signal);
    if (this.pid > 0) b.killPid(this.pid, sig);
    this.killed = true;
    return true;
  }
}

module.exports = {
  ChildProcess,
  spawnSync,
  execSync,
  execFileSync,
  spawn,
  exec,
  execFile,
  fork,
};
