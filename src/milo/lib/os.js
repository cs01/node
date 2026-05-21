// os module — thin wrapper over internalBinding('os')
'use strict';

const b = internalBinding('os');
const constants = internalBinding('constants').os;

module.exports = {
  hostname: () => b.getHostname(),
  cpus: () => { const n = b.getAvailableParallelism(); return Array.from({length: n}, () => ({model: b.getCpuModel(), speed: 0, times: {user:0,nice:0,sys:0,idle:0,irq:0}})); },
  availableParallelism: () => b.getAvailableParallelism(),
  freemem: () => b.getFreeMem(),
  totalmem: () => b.getTotalMem(),
  uptime: () => b.getUptime(),
  loadavg: () => [b.getLoadAvg1(), b.getLoadAvg5(), b.getLoadAvg15()],
  release: () => b.getOsRelease(),
  type: () => 'Darwin',
  platform: () => process.platform || 'darwin',
  arch: () => process.arch || 'arm64',
  endianness: () => 'LE',
  userInfo: () => ({ uid: -1, gid: -1, username: process.env.USER || '', homedir: process.env.HOME || '/', shell: process.env.SHELL || '/bin/zsh' }),
  networkInterfaces: () => ({}),
  homedir: () => process.env.HOME || '/',
  tmpdir: () => process.env.TMPDIR || '/tmp',
  EOL: '\n',
  constants,
};
