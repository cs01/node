// milo-node: recursive directory listing with file sizes
const fs = require('fs');
const path = require('path');

const target = process.argv[2] || '.';

function walk(dir, depth) {
  if (depth > 3) return;
  const indent = '  '.repeat(depth);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }

  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      console.log(`${indent}${name}/`);
      walk(full, depth + 1);
    } else {
      const kb = (stat.size / 1024).toFixed(1);
      console.log(`${indent}${name}  (${kb} KB)`);
    }
  }
}

console.log(`\n  ${path.resolve(target)}\n`);
walk(target, 1);
