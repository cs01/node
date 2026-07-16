// EXPECT_EXIT=0 — passes today: close never-connected server
const net = require('net');
const s = net.createServer().listen(0, () => s.close(() => console.log('closed cb')));
