// EXPECT_EXIT=0 — passes today: destroy() path deregisters cleanly
const net = require('net');
const s = net.createServer((sock) => { sock.on('close', () => s.close(() => console.log('closed'))); })
  .listen(0, () => { const c = net.connect(s.address().port, () => c.destroy()); });
