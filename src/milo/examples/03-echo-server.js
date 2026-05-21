// milo-node: TCP echo server — connect with `nc localhost 4000`
const net = require('net');

const server = net.createServer((socket) => {
  const addr = socket.remoteAddress + ':' + socket.remotePort;
  console.log(`  connected: ${addr}`);
  socket.write('welcome to milo-node echo server\n');

  socket.on('data', (data) => {
    const msg = data.toString().trim();
    console.log(`  [${addr}] ${msg}`);
    if (msg === 'quit') {
      socket.write('bye\n');
      socket.destroy();
      return;
    }
    socket.write(`echo: ${msg}\n`);
  });

  socket.on('close', () => console.log(`  disconnected: ${addr}`));
});

server.listen(4000, () => {
  console.log('  milo-node echo server on :4000');
  console.log('  try: nc localhost 4000');
});
