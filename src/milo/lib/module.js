// module module — Module class stub
'use strict';

class Module {
  constructor(id, parent) {
    this.id = id;
    this.parent = parent || null;
    this.filename = id;
    this.loaded = false;
    this.children = [];
    this.exports = {};
    this.paths = [];
  }

  static createRequire(filename) {
    return globalThis.require;
  }

  static builtinModules = [
    'assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto',
    'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https', 'module',
    'net', 'os', 'path', 'punycode', 'querystring', 'readline', 'stream',
    'string_decoder', 'tls', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
  ];

  static isBuiltin(name) {
    if (name.startsWith('node:')) name = name.slice(5);
    return Module.builtinModules.includes(name);
  }

  static _resolveFilename(request, parent) {
    if (Module.isBuiltin(request)) return request;
    if (typeof globalThis.require === 'function' && globalThis.require.resolve) {
      return globalThis.require.resolve(request);
    }
    return request;
  }

  static _extensions = {
    '.js': function(module, filename) {
      const fs = require('fs');
      const content = fs.readFileSync(filename, 'utf8');
      module._compile(content, filename);
    },
    '.json': function(module, filename) {
      const fs = require('fs');
      const content = fs.readFileSync(filename, 'utf8');
      module.exports = JSON.parse(content);
    },
    '.node': function() { throw new Error('.node addons not supported'); },
  };

  _compile(content, filename) {
    this.loaded = true;
  }
}

Module._cache = typeof globalThis.require !== 'undefined' && globalThis.require.cache ? globalThis.require.cache : {};

module.exports = Module;
