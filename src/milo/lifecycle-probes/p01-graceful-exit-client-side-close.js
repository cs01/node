// EXPECT_EXIT=124 MAX_CPU=1.5
// GROUND TRUTH (real node v25.3.0): HANGS. The server never reads the buffered 'hi', so the
// readable side never ends, 'end' never fires, sock.end() is never called, and both sockets
// stay open forever. Correct node semantics — do NOT "fix" this to exit 0.
// What this probe actually guards: milo must SLEEP while hanging, not spin. Before the
// EOF-poll-deregister fix it burned 100% cpu and fatal-OOMed in ~10s.
const net = require('net');
const server = net.createServer((sock) => { sock.on('end', () => sock.end()); });
server.listen(0, () => {
  const c = net.connect(server.address().port, () => { c.write('hi'); c.end(); });
  c.on('close', () => { server.close(() => console.log('all closed, exiting')); });
});
