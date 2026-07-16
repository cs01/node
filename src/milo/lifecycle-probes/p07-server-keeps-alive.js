// EXPECT_EXIT=124 MAX_CPU=1.5 — GROUND TRUTH (real node): open listening server keeps process alive. Guards no-spin-while-idle.
require('net').createServer().listen(0, () => console.log('listening'));
