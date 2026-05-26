// os module — thin wrapper over internalBinding('os')
'use strict';

const b = internalBinding('os');
const constants = internalBinding('constants').os;

function cpus() {
  const model = b.getCpuModel();
  const speed = b.getCpuSpeed();
  const times = b.getCpuTimes();
  const n = times.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push({
      model,
      speed,
      times: { user: times[i].user, nice: times[i].nice, sys: times[i].sys, idle: times[i].idle, irq: 0 },
    });
  }
  return result;
}

function networkInterfaces() {
  const raw = b.getNetInterfaces();
  if (!raw) return {};
  const result = {};
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 4) continue;
    const [name, fam, address, netmask, mac] = parts;
    const family = fam === '4' ? 'IPv4' : 'IPv6';
    const internal = address === '127.0.0.1' || address === '::1';
    if (!result[name]) result[name] = [];
    result[name].push({ address, netmask, family, mac: mac || '00:00:00:00:00:00', internal, cidr: address + '/' + netmaskToCidr(netmask, family) });
  }
  return result;
}

function netmaskToCidr(mask, family) {
  if (family === 'IPv6') {
    const parts = mask.split(':');
    let bits = 0;
    for (const p of parts) {
      if (!p) continue;
      const n = parseInt(p, 16);
      for (let i = 15; i >= 0; i--) { if (n & (1 << i)) bits++; else return bits; }
    }
    return bits;
  }
  const parts = mask.split('.');
  let bits = 0;
  for (const p of parts) {
    let n = parseInt(p);
    while (n & 128) { bits++; n = (n << 1) & 255; }
  }
  return bits;
}

function userInfo(options) {
  const uid = b.getUid();
  const gid = b.getGid();
  const raw = b.getUserInfo();
  let username, homedir, shell;
  if (raw) {
    const parts = raw.split('|');
    if (parts.length >= 3) { username = parts[0]; homedir = parts[1]; shell = parts[2]; }
  }
  if (!username) { username = process.env.USER || ''; homedir = process.env.HOME || '/'; shell = process.env.SHELL || '/bin/zsh'; }
  if (options && options.encoding === 'buffer') {
    return { uid, gid, username: Buffer.from(username), homedir: Buffer.from(homedir), shell: Buffer.from(shell) };
  }
  return { uid, gid, username, homedir, shell };
}

// Wrap os functions so ${os.hostname} === os.hostname() (Node v22+ behavior)
function _wrap(fn) {
  const wrapped = function(...args) { return fn(...args); };
  wrapped[Symbol.toPrimitive] = () => fn();
  return wrapped;
}

module.exports = {
  hostname: _wrap(() => b.getHostname()),
  cpus,
  availableParallelism: _wrap(() => b.getAvailableParallelism()),
  freemem: _wrap(() => b.getFreeMem()),
  totalmem: _wrap(() => b.getTotalMem()),
  uptime: _wrap(() => b.getUptime()),
  loadavg: () => [b.getLoadAvg1(), b.getLoadAvg5(), b.getLoadAvg15()],
  release: _wrap(() => b.getOsRelease()),
  type: _wrap(() => b.getSysname ? b.getSysname() : 'Darwin'),
  platform: _wrap(() => process.platform || 'darwin'),
  arch: _wrap(() => process.arch || 'arm64'),
  machine: _wrap(() => b.getMachine ? b.getMachine() : 'arm64'),
  version: _wrap(() => b.getOsRelease ? b.getOsRelease() : ''),
  endianness: _wrap(() => 'LE'),
  userInfo,
  networkInterfaces,
  homedir: _wrap(() => process.env.HOME || '/'),
  tmpdir: _wrap(() => {
    let d = process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
    if (d.length > 1 && d.endsWith('/')) d = d.slice(0, -1);
    return d;
  }),
  setPriority: (pid, priority) => { if (priority === undefined) { priority = pid; pid = 0; } return b.setPriority(pid, priority); },
  getPriority: (pid) => b.getPriority(pid || 0),
  devNull: '/dev/null',
  constants,
};
Object.defineProperty(module.exports, 'EOL', { value: '\n', writable: false, enumerable: true, configurable: true });
