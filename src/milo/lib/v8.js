// v8 module — V8 engine info
'use strict';

module.exports = {
  getHeapStatistics: () => ({
    total_heap_size: 0, total_heap_size_executable: 0, total_physical_size: 0,
    total_available_size: 0, used_heap_size: 0, heap_size_limit: 0,
    malloced_memory: 0, peak_malloced_memory: 0, does_zap_garbage: 0,
    number_of_native_contexts: 0, number_of_detached_contexts: 0,
    external_memory: 0,
  }),
  getHeapSpaceStatistics: () => [],
  getHeapSnapshot: () => { throw new Error('v8.getHeapSnapshot not implemented'); },
  getHeapCodeStatistics: () => ({ code_and_metadata_size: 0, bytecode_and_metadata_size: 0, external_script_source_size: 0, cpu_profiler_metadata_size: 0 }),
  setFlagsFromString: () => {},
  serialize: (value) => Buffer.from(JSON.stringify(value)),
  deserialize: (buf) => JSON.parse(buf.toString()),
  cachedDataVersionTag: () => 0,
  writeHeapSnapshot: () => '',
  setHeapSnapshotNearHeapLimit: () => {},
  promiseHooks: { onInit: () => ({}), onSettled: () => ({}), onBefore: () => ({}), onAfter: () => ({}), createHook: () => ({}) },
  startupSnapshot: { addDeserializeCallback: () => {}, addSerializeCallback: () => {}, setDeserializeMainFunction: () => {}, isBuildingSnapshot: () => false },
  GCProfiler: class GCProfiler { start() {} stop() { return { version: 1, startTime: 0, endTime: 0, statistics: [] }; } },
  startHeapProfile(opts) {
    if (opts !== undefined && typeof opts !== 'object') { const e = new TypeError('The "options" argument must be of type object'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (opts) {
      if (opts.sampleInterval !== undefined) {
        if (typeof opts.sampleInterval !== 'number') { const e = new TypeError('The "options.sampleInterval" property must be of type number'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
        if (!Number.isInteger(opts.sampleInterval) || opts.sampleInterval < 1) { const e = new RangeError('The "options.sampleInterval" property must be >= 1'); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
      }
    }
  },
  stopHeapProfile() { return { head: {} }; },
};
