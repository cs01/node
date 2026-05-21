// diagnostics_channel module
'use strict';

const channels = new Map();

class Channel {
  constructor(name) {
    this.name = name;
    this._subscribers = [];
  }

  get hasSubscribers() { return this._subscribers.length > 0; }

  subscribe(fn) { this._subscribers.push(fn); }
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
  subscribe(handlers) { for (const [k, fn] of Object.entries(handlers)) { if (this[k]) this[k].subscribe(fn); } }
  unsubscribe(handlers) { for (const [k, fn] of Object.entries(handlers)) { if (this[k]) this[k].unsubscribe(fn); } }
  traceSync(fn, ctx) { this.start.publish(ctx); try { return fn(ctx); } catch(e) { ctx.error = e; this.error.publish(ctx); throw e; } finally { this.end.publish(ctx); } }
}

function tracingChannel(name) { return new TracingChannel(name); }

module.exports = { channel, hasSubscribers, subscribe, unsubscribe, Channel, tracingChannel, TracingChannel };
