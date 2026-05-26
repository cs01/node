// diagnostics_channel module
'use strict';

const channels = new Map();

class Channel {
  constructor(name) {
    this.name = name;
    this._subscribers = [];
  }

  get hasSubscribers() { return this._subscribers.length > 0; }

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
    for (const fn of this._subscribers) fn(message, this.name);
  }
}

function channel(name) {
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
  constructor(name) {
    this.start = channel(`tracing:${name}:start`);
    this.end = channel(`tracing:${name}:end`);
    this.asyncStart = channel(`tracing:${name}:asyncStart`);
    this.asyncEnd = channel(`tracing:${name}:asyncEnd`);
    this.error = channel(`tracing:${name}:error`);
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
