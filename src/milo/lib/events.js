// events module — EventEmitter (function-based for util.inherits/.call() compat)
'use strict';

function EventEmitter() {
  if (!(this instanceof EventEmitter)) return new EventEmitter();
  this._events = Object.create(null);
  this._maxListeners = EventEmitter.defaultMaxListeners;
}

EventEmitter.prototype.setMaxListeners = function(n) { this._maxListeners = n; return this; };
EventEmitter.prototype.getMaxListeners = function() { return this._maxListeners; };

EventEmitter.prototype.emit = function(type) {
  if (!this._events) this._events = Object.create(null);
  const handlers = this._events[type];
  if (!handlers || handlers.length === 0) {
    if (type === 'error') {
      const err = arguments[1];
      if (err instanceof Error) throw err;
      const e = new Error('Unhandled error.' + (err ? ' (' + err + ')' : ''));
      e.context = err;
      throw e;
    }
    return false;
  }
  const args = new Array(arguments.length - 1);
  for (let i = 1; i < arguments.length; i++) args[i - 1] = arguments[i];
  const copy = handlers.slice();
  for (let i = 0; i < copy.length; i++) copy[i].apply(this, args);
  return true;
};

EventEmitter.prototype.on = function(type, fn) {
  if (typeof fn !== 'function') throw new TypeError('listener must be a function');
  if (!this._events) this._events = Object.create(null);
  (this._events[type] || (this._events[type] = [])).push(fn);
  if (type !== 'newListener') this.emit('newListener', type, fn);
  return this;
};

EventEmitter.prototype.addListener = EventEmitter.prototype.on;

EventEmitter.prototype.prependListener = function(type, fn) {
  if (typeof fn !== 'function') throw new TypeError('listener must be a function');
  if (!this._events) this._events = Object.create(null);
  (this._events[type] || (this._events[type] = [])).unshift(fn);
  return this;
};

EventEmitter.prototype.once = function(type, fn) {
  const self = this;
  function wrapped() { self.removeListener(type, wrapped); fn.apply(self, arguments); }
  wrapped.listener = fn;
  return this.on(type, wrapped);
};

EventEmitter.prototype.prependOnceListener = function(type, fn) {
  const self = this;
  function wrapped() { self.removeListener(type, wrapped); fn.apply(self, arguments); }
  wrapped.listener = fn;
  return this.prependListener(type, wrapped);
};

EventEmitter.prototype.removeListener = function(type, fn) {
  if (!this._events) this._events = Object.create(null);
  const list = this._events[type];
  if (!list) return this;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] === fn || list[i].listener === fn) {
      list.splice(i, 1);
      break;
    }
  }
  if (list.length === 0) delete this._events[type];
  return this;
};

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners = function(type) {
  if (!this._events) this._events = Object.create(null);
  if (type !== undefined) delete this._events[type];
  else this._events = Object.create(null);
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) return [];
  return (this._events[type] || []).map(function(h) { return h.listener || h; });
};

EventEmitter.prototype.rawListeners = function(type) {
  if (!this._events) return [];
  return (this._events[type] || []).slice();
};

EventEmitter.prototype.listenerCount = function(type, listener) {
  if (!this._events) return 0;
  const list = this._events[type] || [];
  if (listener === undefined) return list.length;
  return list.filter(function(h) { return h === listener || h.listener === listener; }).length;
};

EventEmitter.prototype.eventNames = function() {
  if (!this._events) return [];
  return Object.keys(this._events).concat(Object.getOwnPropertySymbols(this._events));
};

EventEmitter.defaultMaxListeners = 10;
EventEmitter.EventEmitter = EventEmitter;
EventEmitter.listenerCount = function(emitter, type) { return emitter.listenerCount(type); };
EventEmitter.getEventListeners = function(emitter, type) { return emitter.listeners(type); };
EventEmitter.getMaxListeners = function(emitter) {
  if (typeof emitter.getMaxListeners === 'function') return emitter.getMaxListeners();
  return emitter._maxListeners !== undefined ? emitter._maxListeners : EventEmitter.defaultMaxListeners;
};
EventEmitter.setMaxListeners = function(n) {
  if (arguments.length <= 1) { EventEmitter.defaultMaxListeners = n; return; }
  for (let i = 1; i < arguments.length; i++) {
    if (typeof arguments[i].setMaxListeners === 'function') arguments[i].setMaxListeners(n);
    else arguments[i]._maxListeners = n;
  }
};

function once(emitter, type) {
  return new Promise(function(resolve, reject) {
    var onErr = function(e) { emitter.removeListener(type, onRes); reject(e); };
    var onRes = function() {
      emitter.removeListener('error', onErr);
      var args = new Array(arguments.length);
      for (var i = 0; i < arguments.length; i++) args[i] = arguments[i];
      resolve(args);
    };
    emitter.once(type, onRes);
    if (type !== 'error') emitter.once('error', onErr);
  });
}

EventEmitter.once = once;
EventEmitter.captureRejections = false;
EventEmitter.captureRejectionSymbol = Symbol.for('nodejs.rejection');
EventEmitter.errorMonitor = Symbol('events.errorMonitor');

EventEmitter.on = function on(emitter, event, options) {
  var unconsumedEvents = [];
  var unconsumedPromises = [];
  var error = null;
  var finished = false;

  var eventHandler = function() {
    var value = arguments.length === 1 ? arguments[0] : Array.prototype.slice.call(arguments);
    if (unconsumedPromises.length > 0) {
      unconsumedPromises.shift().resolve({ value: value, done: false });
    } else {
      unconsumedEvents.push(value);
    }
  };

  var errorHandler = function(err) {
    error = err;
    if (unconsumedPromises.length > 0) {
      unconsumedPromises.shift().reject(err);
    }
  };

  emitter.on(event, eventHandler);
  if (event !== 'error') emitter.on('error', errorHandler);

  var iterator = {
    next: function() {
      if (unconsumedEvents.length > 0) {
        return Promise.resolve({ value: unconsumedEvents.shift(), done: false });
      }
      if (error) { var err = error; error = null; return Promise.reject(err); }
      if (finished) return Promise.resolve({ done: true });
      return new Promise(function(resolve, reject) { unconsumedPromises.push({ resolve: resolve, reject: reject }); });
    },
    return: function() {
      finished = true;
      emitter.removeListener(event, eventHandler);
      emitter.removeListener('error', errorHandler);
      for (var i = 0; i < unconsumedPromises.length; i++) unconsumedPromises[i].resolve({ done: true });
      return Promise.resolve({ done: true });
    },
    throw: function(err) { error = err; return this.return(); },
  };
  iterator[Symbol.asyncIterator] = function() { return this; };

  if (options && options.signal) {
    options.signal.addEventListener('abort', function() { iterator.return(); });
  }

  return iterator;
};

EventEmitter.addAbortListener = function(signal, listener) {
  signal.addEventListener('abort', listener);
  return { [Symbol.dispose]: function() { signal.removeEventListener('abort', listener); } };
};

module.exports = EventEmitter;
module.exports.getMaxListeners = EventEmitter.getMaxListeners;
module.exports.setMaxListeners = EventEmitter.setMaxListeners;
module.exports.defaultMaxListeners = EventEmitter.defaultMaxListeners;
module.exports.once = once;
module.exports.on = EventEmitter.on;
module.exports.addAbortListener = EventEmitter.addAbortListener;
module.exports.getEventListeners = EventEmitter.getEventListeners;
module.exports.listenerCount = EventEmitter.listenerCount;
module.exports.captureRejections = EventEmitter.captureRejections;
module.exports.captureRejectionSymbol = EventEmitter.captureRejectionSymbol;
module.exports.errorMonitor = EventEmitter.errorMonitor;
