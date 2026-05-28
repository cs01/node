// diagnostics_channel module
'use strict';

const channels = new Map();

class Channel {
  constructor(name) {
    this.name = name;
    this._subscribers = [];
  }

  get hasSubscribers() { return this._subscribers.length > 0; }

  bindStore(store, transform) {
    if (!this._stores) this._stores = [];
    this._stores.push({ store, transform: transform || ((data) => data) });
  }

  unbindStore(store) {
    if (!this._stores) return false;
    const idx = this._stores.findIndex(s => s.store === store);
    if (idx >= 0) { this._stores.splice(idx, 1); return true; }
    return false;
  }

  runStores(data, fn, thisArg, ...args) {
    if (!this._stores || this._stores.length === 0) return fn.apply(thisArg, args);
    let result;
    const run = (i) => {
      if (i >= this._stores.length) { result = fn.apply(thisArg, args); return; }
      const { store, transform } = this._stores[i];
      store.run(transform(data), () => run(i + 1));
    };
    run(0);
    return result;
  }

  subscribe(fn) {
    if (typeof fn !== 'function') {
      const err = new TypeError('The "onMessage" argument must be of type function. Received ' + typeof fn);
      err.code = 'ERR_INVALID_ARG_TYPE';
      throw err;
    }
    this._subscribers.push(fn);
  }
  unsubscribe(fn) {
    const idx = this._subscribers.indexOf(fn);
    if (idx >= 0) { this._subscribers.splice(idx, 1); return true; }
    return false;
  }

  publish(message) {
    const subs = this._subscribers.slice();
    for (const fn of subs) fn(message, this.name);
  }
}

function channel(name) {
  if (typeof name !== 'string' && typeof name !== 'symbol') {
    const received = name === null ? 'null' : name === undefined ? 'undefined' : 'type ' + typeof name;
    const e = new TypeError('[ERR_INVALID_ARG_TYPE]: The "name" argument must be of type string or an instance of Symbol. Received ' + received);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (!channels.has(name)) channels.set(name, new Channel(name));
  return channels.get(name);
}

function hasSubscribers(name) {
  const ch = channels.get(name);
  return ch ? ch.hasSubscribers : false;
}

function subscribe(name, fn) { channel(name).subscribe(fn); }
function unsubscribe(name, fn) { return channel(name).unsubscribe(fn); }

class TracingChannel {
  constructor(nameOrChannels) {
    if (typeof nameOrChannels === 'string') {
      this.start = channel(`tracing:${nameOrChannels}:start`);
      this.end = channel(`tracing:${nameOrChannels}:end`);
      this.asyncStart = channel(`tracing:${nameOrChannels}:asyncStart`);
      this.asyncEnd = channel(`tracing:${nameOrChannels}:asyncEnd`);
      this.error = channel(`tracing:${nameOrChannels}:error`);
    } else if (typeof nameOrChannels === 'object' && nameOrChannels !== null) {
      const required = ['start', 'end', 'asyncStart', 'asyncEnd', 'error'];
      for (const k of required) {
        const val = nameOrChannels[k];
        if (val !== undefined && !(val instanceof Channel)) {
          const e = new TypeError(`The "nameOrChannels.${k}" property must be an instance of Channel. Received type ${typeof val} (${JSON.stringify(val)})`);
          e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
        }
      }
      for (const k of required) {
        // Node throws TypeError when accessing properties on undefined channel
        if (nameOrChannels[k] === undefined) Object.keys(nameOrChannels[k]);
        this[k] = nameOrChannels[k];
      }
    } else {
      const e = new TypeError('The "nameOrChannels" argument must be of type string or an instance of TracingChannel or Object. Received type ' + typeof nameOrChannels + ' (' + nameOrChannels + ')');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
  }
  get hasSubscribers() { return this.start.hasSubscribers || this.end.hasSubscribers || this.asyncStart.hasSubscribers || this.asyncEnd.hasSubscribers || this.error.hasSubscribers; }
  subscribe(handlers) { for (const [k, fn] of Object.entries(handlers)) { if (this[k]) this[k].subscribe(fn); } }
  unsubscribe(handlers) { for (const [k, fn] of Object.entries(handlers)) { if (this[k]) this[k].unsubscribe(fn); } }
  traceSync(fn, ctx, thisArg, ...args) { this.start.publish(ctx); try { const result = fn.apply(thisArg, args); ctx.result = result; return result; } catch(e) { ctx.error = e; this.error.publish(ctx); throw e; } finally { this.end.publish(ctx); } }
  tracePromise(fn, ctx) {
    this.start.publish(ctx);
    try {
      const result = fn(ctx);
      return Promise.resolve(result).then(
        (v) => { this.asyncStart.publish(ctx); this.asyncEnd.publish(ctx); this.end.publish(ctx); return v; },
        (e) => { ctx.error = e; this.error.publish(ctx); this.asyncStart.publish(ctx); this.asyncEnd.publish(ctx); this.end.publish(ctx); throw e; }
      );
    } catch (e) { ctx.error = e; this.error.publish(ctx); this.end.publish(ctx); throw e; }
  }
  traceCallback(fn, position, ctx, thisArg, ...args) {
    const origCb = args[position];
    const self = this;
    args[position] = function(...cbArgs) {
      if (cbArgs[0]) {
        ctx.error = cbArgs[0];
        self.error.publish(ctx);
      }
      self.asyncStart.publish(ctx);
      try { if (origCb) return origCb.apply(this, cbArgs); }
      finally { self.asyncEnd.publish(ctx); self.end.publish(ctx); }
    };
    this.start.publish(ctx);
    try { return fn.apply(thisArg, args); } catch(e) { ctx.error = e; this.error.publish(ctx); this.end.publish(ctx); throw e; }
  }
}

function tracingChannel(name) { return new TracingChannel(name); }

module.exports = { channel, hasSubscribers, subscribe, unsubscribe, Channel, tracingChannel, TracingChannel };
