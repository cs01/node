// milo-node: ROT13 cipher via transform stream
const { Transform } = require('stream');

function rot13(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 65 && c <= 90) return String.fromCharCode(((c - 65 + 13) % 26) + 65);
  if (c >= 97 && c <= 122) return String.fromCharCode(((c - 97 + 13) % 26) + 97);
  return ch;
}

function rot13str(s) { return s.split('').map(rot13).join(''); }

const messages = [
  'Hello from milo-node!',
  'Milo compiles to native code via LLVM.',
  'This is a transform stream pipeline.',
];

for (const msg of messages) {
  const encoded = rot13str(msg);
  const decoded = rot13str(encoded);
  console.log(`  original:  ${msg}`);
  console.log(`  rot13:     ${encoded}`);
  console.log(`  roundtrip: ${decoded}`);
  console.log();
}

console.log('  ROT13 is its own inverse — encode and decode are the same operation.');
