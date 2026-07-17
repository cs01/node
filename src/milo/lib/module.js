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
    const _path = require('path');
    const _throw = () => {
      const e = new TypeError(`The argument 'filename' must be a file URL object, file URL string, or absolute path string. Received ${require('util').inspect(filename)}`);
      e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
    };
    let filepath;
    const isURLObj = filename !== null && typeof filename === 'object' &&
      typeof filename.href === 'string' && typeof filename.protocol === 'string';
    if (isURLObj) {
      if (filename.protocol !== 'file:') _throw();
      filepath = require('url').fileURLToPath(filename);
    } else if (typeof filename === 'string') {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(filename)) {
        // has a URL scheme — only file: is acceptable (rejects https:// etc)
        if (!filename.startsWith('file:')) _throw();
        filepath = require('url').fileURLToPath(new URL(filename));
      } else if (_path.isAbsolute(filename)) {
        filepath = filename;
      } else {
        _throw(); // relative path string like '../' is not allowed
      }
    } else {
      _throw();
    }
    return globalThis._makeRequire(_path.dirname(filepath));
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
    // Node-API addons. process.dlopen runs the addon's napi_register_module_v1 and
    // populates module.exports in place.
    '.node': function(module, filename) {
      return process.dlopen(module, filename);
    },
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
    // bare specifier (not ./ ../ / and not .\ on windows): search node_modules paths.
    const isWin = process.platform === 'win32';
    if (request.charAt(0) !== '.' ||
        (request.length > 1 && request.charAt(1) !== '.' && request.charAt(1) !== '/' &&
         (!isWin || request.charAt(1) !== '\\'))) {
      const paths = [];
      if (parent && parent.paths) paths.push(...parent.paths);
      if (Module.globalPaths) paths.push(...Module.globalPaths);
      // node returns the paths array (never null) for non-builtin bare specifiers;
      // null is reserved for builtins.
      return paths;
    }
    // relative/absolute: current dir wins. Without a real parent (REPL/-e), node
    // returns ['.']; otherwise the parent's directory.
    if (!parent || !parent.id || !parent.filename) return ['.'];
    return [require('path').dirname(parent.filename)];
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

// Entry point runner — the native [main] bootstrap calls this so it can be
// monkey-patched (e.g. by a --require preload) before the main module loads.
Module.runMain = function() {
  const main = globalThis.require && globalThis.require.main;
  if (main && main.filename) globalThis.require(main.filename);
};

module.exports = Module;
