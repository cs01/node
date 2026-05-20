// url module — minimal stub for test/common compatibility
'use strict';
module.exports = {
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  pathToFileURL: (p) => new URL('file://' + (p.startsWith('/') ? '' : '/') + p),
  fileURLToPath: (u) => { const s = typeof u === 'string' ? u : u.href; return s.replace(/^file:\/\//, ''); },
  format: (u) => typeof u === 'string' ? u : u.href,
};
