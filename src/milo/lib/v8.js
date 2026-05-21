// v8 module — V8 engine info
'use strict';

module.exports = {
  getHeapStatistics: () => ({
    total_heap_size: 0, total_heap_size_executable: 0, total_physical_size: 0,
    total_available_size: 0, used_heap_size: 0, heap_size_limit: 0,
    malloced_memory: 0, peak_malloced_memory: 0, does_zap_garbage: 0,
    number_of_native_contexts: 0, number_of_detached_contexts: 0,
  }),
  getHeapSpaceStatistics: () => [],
  getHeapSnapshot: () => { throw new Error('v8.getHeapSnapshot not implemented'); },
  setFlagsFromString: () => {},
  serialize: (value) => Buffer.from(JSON.stringify(value)),
  deserialize: (buf) => JSON.parse(buf.toString()),
};
