// perf_hooks module — performance timing
'use strict';

const _perf = globalThis.performance || { now: () => Date.now(), timeOrigin: Date.now() };

class PerformanceObserver {
  constructor(cb) { this._cb = cb; }
  observe() {}
  disconnect() {}
}

class PerformanceEntry {
  constructor(name, type, start, duration) {
    this.name = name; this.entryType = type;
    this.startTime = start; this.duration = duration;
  }
}

const performance = {
  now: () => _perf.now(),
  timeOrigin: _perf.timeOrigin,
  mark(name) { return new PerformanceEntry(name, 'mark', _perf.now(), 0); },
  measure(name, start, end) { return new PerformanceEntry(name, 'measure', 0, 0); },
  getEntries: () => [],
  getEntriesByName: () => [],
  getEntriesByType: () => [],
  clearMarks: () => {},
  clearMeasures: () => {},
  timerify: (fn) => fn,
  nodeTiming: { name: 'node', entryType: 'node', startTime: 0, duration: 0, bootstrapComplete: 0 },
  eventLoopUtilization: () => ({ idle: 0, active: 0, utilization: 0 }),
};

module.exports = { performance, PerformanceObserver, PerformanceEntry, monitorEventLoopDelay: () => ({ enable() {}, disable() {}, min: 0, max: 0, mean: 0, percentile: () => 0 }) };
