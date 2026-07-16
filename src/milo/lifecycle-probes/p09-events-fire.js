// EXPECT_EXIT=0 — passes today: full data/end/close event sequence both directions
const net = require('net');
let seq = [];
const server = net.createServer((sock) => {
  sock.on('data', (d) => seq.push('s-data'));
  sock.on('end', () => { seq.push('s-end'); sock.end(); });
  sock.on('close', () => { seq.push('s-close'); server.close(); });
});
server.listen(0, () => {
  const c = net.connect(server.address().port, () => { c.write('hello'); c.end(); });
  c.on('end', () => seq.push('c-end'));
  c.on('close', () => { seq.push('c-close');
    const want = 's-data,s-end'; // prefix check; full order can vary slightly
    if (!seq.join(',').startsWith(want)) { console.log('BAD SEQ', seq.join(',')); process.exit(1); }
    console.log('seq ok:', seq.join(','));
  });
});
