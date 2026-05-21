// milo-node: system info at a glance
const os = require('os');
const path = require('path');

console.log(`  milo-node ${process.version}`);
console.log(`  pid ${process.pid} on ${os.hostname()}`);
console.log(`  ${os.platform}/${os.arch} — ${os.cpus().length} cores, ${(os.totalmem() / 1e9).toFixed(1)} GB RAM`);
console.log(`  cwd: ${process.cwd()}`);
console.log(`  uptime: ${os.uptime()}s`);
console.log(`  load: ${os.loadavg()}`);
