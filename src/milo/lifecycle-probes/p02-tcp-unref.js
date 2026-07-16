// EXPECT_EXIT=0 — KNOWN FAILING: socket/server unref not implemented, process hangs
const net = require('net');
const s = net.createServer(() => {}).listen(0, () => {
  const c = net.connect(s.address().port, () => { c.unref(); s.unref(); console.log('both unrefd'); });
});
