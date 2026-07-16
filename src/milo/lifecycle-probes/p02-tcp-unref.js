// EXPECT_EXIT=0 MAX_CPU=1.5
// GROUND TRUTH: ./out/Release/node (v27.0.0-pre, built from THIS tree) — not the PATH `node`.
// Deterministic by construction: the earlier version unref'd inside the client's connect
// callback, which raced the server's accept, so real node returned 0 or 124 depending on
// machine load (it "hung" once under no load and I wrote that down as ground truth).
// Here nothing is unref'd until BOTH sides are established, so the probe tests exactly one
// thing: do unref'd TCP handles stop holding the loop open?
const net = require('net');
let up = 0;
const server = net.createServer((sock) => { sock.unref(); ready(); });
server.listen(0, () => {
  const c = net.connect(server.address().port, () => { c.unref(); ready(); });
});
// holds the loop open until both ends are up, so exit can only mean "unref worked"
const guard = setInterval(() => {}, 10);
function ready() {
  if (++up < 2) return;
  server.unref();
  clearInterval(guard);
  console.log('server + accepted socket + client all unrefd; loop should drain');
}
