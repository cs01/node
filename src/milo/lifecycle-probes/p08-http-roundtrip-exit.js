// EXPECT_EXIT=0 — passes today: http roundtrip then server.close exits
const http = require('http');
const s = http.createServer((req, res) => res.end('ok')).listen(0, () => {
  http.get({ port: s.address().port }, (res) => {
    res.on('data', () => {});
    res.on('end', () => s.close(() => console.log('closed')));
  });
});
