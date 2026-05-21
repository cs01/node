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
}

module.exports = Module;
