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
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
    'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'punycode', 'querystring',
    'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'tty',
    'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
  ];

  // Modules only accessible via node: prefix
  static _nodeOnlyModules = ['test', 'sea', 'sqlite'];

  static isBuiltin(name) {
    if (typeof name !== 'string' || name === '') return false;
    if (name.startsWith('node:')) {
      const bare = name.slice(5);
      return Module.builtinModules.includes(bare) || Module._nodeOnlyModules.includes(bare);
    }
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

  static _stat(filename) {
    const fs = require('fs');
    try {
      const stat = fs.statSync(filename);
      if (stat.isDirectory()) return 1;
      return 0;
    } catch { return -2; }
  }

  static _nodeModulePaths(from) {
    const path = require('path');
    from = path.resolve(from);
    if (from === path.sep) return [path.sep + 'node_modules'];
    const paths = [];
    const parts = from.split(path.sep);
    for (let i = parts.length; i > 0; i--) {
      if (parts[i - 1] === 'node_modules') continue;
      const dir = parts.slice(0, i).join(path.sep) || path.sep;
      paths.push(path.join(dir, 'node_modules'));
    }
    return paths;
  }

  static _resolveLookupPaths(request, parent) {
    if (Module.isBuiltin(request)) return null;
    const paths = [];
    if (parent && parent.paths) paths.push(...parent.paths);
    if (Module.globalPaths) paths.push(...Module.globalPaths);
    return paths.length > 0 ? paths : null;
  }

  static wrap(script) {
    return Module.wrapper[0] + script + Module.wrapper[1];
  }

  static wrapper = [
    '(function (exports, require, module, __filename, __dirname) { ',
    '\n});'
  ];
}

Module.globalPaths = [];
Module._cache = typeof globalThis.require !== 'undefined' && globalThis.require.cache ? globalThis.require.cache : {};
Module._initPaths = function() {
  const paths = [];
  if (process.env.NODE_PATH) {
    const sep = process.platform === 'win32' ? ';' : ':';
    paths.push(...process.env.NODE_PATH.split(sep).filter(Boolean));
  }
  Module.globalPaths = paths;
};
Module._initPaths();

module.exports = Module;
