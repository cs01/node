// vm module — Script, createContext, runInContext via eval/Function
'use strict';

class Script {
  constructor(code, options) {
    this._code = code;
    this._filename = (options && options.filename) || 'evalmachine.<anonymous>';
  }

  runInThisContext(options) {
    return (0, eval)(this._code);
  }

  runInNewContext(sandbox, options) {
    return runInNewContext(this._code, sandbox, options);
  }

  runInContext(context, options) {
    return runInContext(this._code, context, options);
  }
}

function createContext(sandbox) {
  if (!sandbox) sandbox = Object.create(null);
  sandbox._isVMContext = true;
  return sandbox;
}

function isContext(sandbox) {
  return !!(sandbox && sandbox._isVMContext);
}

function runInThisContext(code, options) {
  return (0, eval)(code);
}

function runInNewContext(code, sandbox, options) {
  sandbox = sandbox || Object.create(null);
  // Proxy traps bare name reads/writes to sandbox, providing context isolation
  // Proxy intercepts all reads/writes — sandbox-first, then globalThis fallback
  const proxy = new Proxy(sandbox, {
    has() { return true; },
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (key in target) return target[key];
      if (key in globalThis) return globalThis[key];
      return undefined;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const fn = new Function('__ctx__', `with (__ctx__) { return eval(${JSON.stringify(code)}); }`);
  return fn(proxy);
}

function runInContext(code, context, options) {
  return runInNewContext(code, context, options);
}

function compileFunction(code, params, options) {
  params = params || [];
  return new Function(...params, code);
}

module.exports = {
  Script, createContext, isContext, runInThisContext,
  runInNewContext, runInContext, compileFunction,
};
