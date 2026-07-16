// EXPECT_EXIT=0 — KNOWN FAILING: server.close() while conn open never completes after conn ends
const net = require('net');
const server = net.createServer((sock) => { sock.on('end', () => sock.end()); });
server.listen(0, () => {
  const c = net.connect(server.address().port, () => { c.write('hi'); c.end(); });
  c.on('close', () => { server.close(() => console.log('all closed, exiting')); });
});
