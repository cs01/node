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
  const keys = Object.keys(sandbox);
  const vals = keys.map(k => sandbox[k]);
  // Pass sandbox vars as params, write back after execution
  const returnKeys = keys.map(k => `__sb__['${k}'] = ${k};`).join(' ');
  let fn;
  try {
    fn = new Function('__sb__', ...keys, `var __r__ = (${code}); ${returnKeys} return __r__;`);
  } catch {
    fn = new Function('__sb__', ...keys, `${code}\n${returnKeys}`);
  }
  return fn(sandbox, ...vals);
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
