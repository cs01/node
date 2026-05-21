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
    const [name, fam, address, netmask] = parts;
    const family = fam === '4' ? 'IPv4' : 'IPv6';
    const internal = address === '127.0.0.1' || address === '::1';
    if (!result[name]) result[name] = [];
    result[name].push({ address, netmask, family, mac: '00:00:00:00:00:00', internal, cidr: address + '/' + netmaskToCidr(netmask, family) });
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
  if (raw) {
    const parts = raw.split('|');
    if (parts.length >= 3) {
      return { uid, gid, username: parts[0], homedir: parts[1], shell: parts[2] };
    }
  }
  return { uid, gid, username: process.env.USER || '', homedir: process.env.HOME || '/', shell: process.env.SHELL || '/bin/zsh' };
}

module.exports = {
  hostname: () => b.getHostname(),
  cpus,
  availableParallelism: () => b.getAvailableParallelism(),
  freemem: () => b.getFreeMem(),
  totalmem: () => b.getTotalMem(),
  uptime: () => b.getUptime(),
  loadavg: () => [b.getLoadAvg1(), b.getLoadAvg5(), b.getLoadAvg15()],
  release: () => b.getOsRelease(),
  type: () => b.getSysname ? b.getSysname() : 'Darwin',
  platform: () => process.platform || 'darwin',
  arch: () => process.arch || 'arm64',
  machine: () => b.getMachine ? b.getMachine() : 'arm64',
  version: () => b.getOsRelease ? b.getOsRelease() : '',
  endianness: () => 'LE',
  userInfo,
  networkInterfaces,
  homedir: () => process.env.HOME || '/',
  tmpdir: () => process.env.TMPDIR || '/tmp',
  setPriority: (pid, priority) => { if (priority === undefined) { priority = pid; pid = 0; } return b.setPriority(pid, priority); },
  getPriority: (pid) => b.getPriority(pid || 0),
  EOL: '\n',
  constants,
};
