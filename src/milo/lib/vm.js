// vm module — real V8 contexts via the native vm binding (realm isolation).
'use strict';

const _vmB = internalBinding('vm');

// sandbox object -> native context handle
const _ctxHandles = new WeakMap();

function _filename(options) {
  return (options && typeof options === 'object' && options.filename) || 'evalmachine.<anonymous>';
}

function _newHandle() {
  const h = _vmB.createContext();
  if (h < 0) throw new Error('vm: too many contexts');
  return h;
}

function createContext(sandbox) {
  if (sandbox === undefined || sandbox === null) sandbox = {};
  if (_ctxHandles.has(sandbox)) return sandbox;
  _ctxHandles.set(sandbox, _newHandle());
  return sandbox;
}

function isContext(sandbox) {
  return _ctxHandles.has(sandbox);
}

// The native run() marshals sandbox<->global using the target context as the
// operative context (the only way foreign-global writes stick), runs the code,
// then syncs script-created globals back onto the sandbox.
function runInNewContext(code, sandbox, options) {
  if (sandbox === undefined || sandbox === null) sandbox = {};
  return _vmB.run(_newHandle(), sandbox, String(code), _filename(options));
}

function runInContext(code, contextifiedSandbox, options) {
  const h = _ctxHandles.get(contextifiedSandbox);
  if (h === undefined) { const e = new TypeError('contextifiedObject argument must be a vm.Context'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
  return _vmB.run(h, contextifiedSandbox, String(code), _filename(options));
}

function runInThisContext(code, options) {
  return (0, eval)(String(code));
}

function compileFunction(code, params, options) {
  params = params || [];
  return new Function(...params, code);
}

class Script {
  constructor(code, options) {
    this._code = code;
    this._filename = _filename(options);
  }
  runInThisContext(options) { return (0, eval)(String(this._code)); }
  runInNewContext(sandbox, options) { return runInNewContext(this._code, sandbox, options || { filename: this._filename }); }
  runInContext(context, options) { return runInContext(this._code, context, options || { filename: this._filename }); }
}

module.exports = {
  Script, createContext, isContext, runInThisContext,
  runInNewContext, runInContext, compileFunction,
};
