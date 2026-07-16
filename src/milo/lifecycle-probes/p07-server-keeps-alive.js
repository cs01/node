// EXPECT_EXIT=124 — passes today: open listening server must KEEP process alive (hang is correct)
require('net').createServer().listen(0, () => console.log('listening'));
