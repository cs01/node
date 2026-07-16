// EXPECT_EXIT=0 — passes today: graceful FIN/FIN, server.close from server-side sock close
const net = require('net');
const s = net.createServer((sock) => {
  sock.on('end', () => sock.end());
  sock.on('close', () => s.close(() => console.log('server closed cb')));
}).listen(0, () => {
  const c = net.connect(s.address().port, () => c.end());
});
