// perf_hooks module — performance timing with real mark/measure tracking
'use strict';

const _perf = globalThis.performance || { now: () => Date.now(), timeOrigin: Date.now() };

class PerformanceEntry {
  constructor(name, type, start, duration) {
    this.name = name;
    this.entryType = type;
    this.startTime = start;
    this.duration = duration;
  }
  toJSON() { return { name: this.name, entryType: this.entryType, startTime: this.startTime, duration: this.duration }; }
}

const _entries = [];
const _observers = new Set();

function _notifyObservers(entry) {
  for (const obs of _observers) {
    if (obs._types.has(entry.entryType)) {
      obs._buffer.push(entry);
      if (obs._buffer.length === 1) {
        process.nextTick(() => {
          if (obs._buffer.length > 0) {
            const list = new PerformanceObserverEntryList(obs._buffer.splice(0));
            obs._cb(list, obs);
          }
        });
      }
    }
  }
}

class PerformanceObserverEntryList {
  constructor(entries) { this._entries = entries; }
  getEntries() { return this._entries.slice(); }
  getEntriesByName(name) { return this._entries.filter(e => e.name === name); }
  getEntriesByType(type) { return this._entries.filter(e => e.entryType === type); }
}

class PerformanceObserver {
  constructor(cb) {
    this._cb = cb;
    this._types = new Set();
    this._buffer = [];
  }
  observe(opts) {
    if (opts.entryTypes) for (const t of opts.entryTypes) this._types.add(t);
    if (opts.type) this._types.add(opts.type);
    _observers.add(this);
  }
  disconnect() { _observers.delete(this); }
}

const performance = {
  now: () => _perf.now(),
  timeOrigin: _perf.timeOrigin,
  mark(name, options) {
    const start = (options && options.startTime != null) ? options.startTime : _perf.now();
    const entry = new PerformanceEntry(name, 'mark', start, 0);
    _entries.push(entry);
    _notifyObservers(entry);
    return entry;
  },
  measure(name, startOrOptions, endMark) {
    let start = 0, end = _perf.now();
    if (typeof startOrOptions === 'string') {
      const sm = _entries.find(e => e.entryType === 'mark' && e.name === startOrOptions);
      if (sm) start = sm.startTime;
      if (endMark) {
        const em = _entries.find(e => e.entryType === 'mark' && e.name === endMark);
        if (em) end = em.startTime;
      }
    } else if (startOrOptions && typeof startOrOptions === 'object') {
      if (startOrOptions.start) {
        const sm = _entries.find(e => e.entryType === 'mark' && e.name === startOrOptions.start);
        if (sm) start = sm.startTime;
      }
      if (startOrOptions.end) {
        const em = _entries.find(e => e.entryType === 'mark' && e.name === startOrOptions.end);
        if (em) end = em.startTime;
      }
      if (startOrOptions.duration != null) end = start + startOrOptions.duration;
    }
    const entry = new PerformanceEntry(name, 'measure', start, end - start);
    _entries.push(entry);
    _notifyObservers(entry);
    return entry;
  },
  getEntries() { return _entries.slice(); },
  getEntriesByName(name) { return _entries.filter(e => e.name === name); },
  getEntriesByType(type) { return _entries.filter(e => e.entryType === type); },
  clearMarks(name) {
    for (let i = _entries.length - 1; i >= 0; i--) {
      if (_entries[i].entryType === 'mark' && (!name || _entries[i].name === name)) _entries.splice(i, 1);
    }
  },
  clearMeasures(name) {
    for (let i = _entries.length - 1; i >= 0; i--) {
      if (_entries[i].entryType === 'measure' && (!name || _entries[i].name === name)) _entries.splice(i, 1);
    }
  },
  timerify(fn) {
    const wrapped = function(...args) {
      const start = _perf.now();
      const result = fn.apply(this, args);
      const dur = _perf.now() - start;
      const entry = new PerformanceEntry(fn.name || 'anonymous', 'function', start, dur);
      _entries.push(entry);
      _notifyObservers(entry);
      return result;
    };
    Object.defineProperty(wrapped, 'name', { value: fn.name });
    return wrapped;
  },
  nodeTiming: { name: 'node', entryType: 'node', startTime: 0, duration: 0, bootstrapComplete: 0 },
  eventLoopUtilization: () => ({ idle: 0, active: 0, utilization: 0 }),
};

module.exports = {
  performance,
  PerformanceObserver,
  PerformanceObserverEntryList,
  PerformanceEntry,
  monitorEventLoopDelay: (options) => {
    const histogram = {
      _enabled: false, min: 0, max: 0, mean: 0, stddev: 0, exceeds: 0,
      percentile: () => 0, percentiles: new Map(),
      enable() { this._enabled = true; }, disable() { this._enabled = false; },
      reset() { this.min = 0; this.max = 0; this.mean = 0; },
    };
    return histogram;
  },
};
