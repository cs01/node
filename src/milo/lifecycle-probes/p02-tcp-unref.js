// EXPECT_EXIT=124 MAX_CPU=1.5
// GROUND TRUTH (real node v25.3.0): HANGS. Unref'ing the client socket and the server does
// NOT unref the server-side ACCEPTED socket, which still holds the loop open. Correct node
// semantics. Guards against busy-spin while hanging, not against the hang itself.
const net = require('net');
const s = net.createServer(() => {}).listen(0, () => {
  const c = net.connect(s.address().port, () => { c.unref(); s.unref(); console.log('both unrefd'); });
});
