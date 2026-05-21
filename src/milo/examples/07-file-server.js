// milo-node: static file server over TCP (raw HTTP/1.1)
// browse to http://localhost:4001/ — serves files from cwd
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = 4001;
const ROOT = process.argv[2] || process.cwd();

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

function respond(socket, status, contentType, body) {
  const header = `HTTP/1.1 ${status}\r\nContent-Type: ${contentType}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
  socket.write(header);
  socket.write(body);
  socket.destroy();
}

function dirListing(dirPath, urlPath) {
  const entries = fs.readdirSync(dirPath);
  const items = entries.map(e => {
    let stat;
    try { stat = fs.statSync(path.join(dirPath, e)); } catch { return ''; }
    const slash = stat.isDirectory() ? '/' : '';
    const size = stat.isDirectory() ? '-' : `${(stat.size / 1024).toFixed(1)}K`;
    const href = path.join(urlPath, e) + slash;
    return `  <tr><td><a href="${href}">${e}${slash}</a></td><td>${size}</td></tr>`;
  }).join('\n');
  return `<html><head><title>${urlPath}</title></head><body><h2>Index of ${urlPath}</h2><table>${items}</table></body></html>`;
}

const server = net.createServer((socket) => {
  let buf = '';
  socket.on('data', (data) => {
    buf += data.toString();
    if (!buf.includes('\r\n')) return;

    const firstLine = buf.split('\r\n')[0];
    const parts = firstLine.split(' ');
    const urlPath = decodeURIComponent(parts[1] || '/').split('?')[0];
    const filePath = path.join(ROOT, urlPath);

    console.log(`  ${parts[0]} ${urlPath}`);

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          const body = fs.readFileSync(indexPath);
          respond(socket, '200 OK', 'text/html', body);
        } else {
          respond(socket, '200 OK', 'text/html', dirListing(filePath, urlPath));
        }
      } else {
        const ext = path.extname(filePath);
        const body = fs.readFileSync(filePath);
        respond(socket, '200 OK', MIME[ext] || 'application/octet-stream', body);
      }
    } catch {
      respond(socket, '404 Not Found', 'text/plain', '404 not found\n');
    }
  });
});

server.listen(PORT, () => {
  console.log(`  milo-node file server on http://localhost:${PORT}`);
  console.log(`  serving: ${path.resolve(ROOT)}`);
});
