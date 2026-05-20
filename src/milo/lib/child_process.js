// child_process module — stub for test/common compatibility
'use strict';
module.exports = {
  spawnSync: () => ({ status: 0, stdout: '', stderr: '', error: new Error('child_process not implemented') }),
  execSync: () => { throw new Error('child_process not implemented'); },
  spawn: () => { throw new Error('child_process not implemented'); },
  exec: () => { throw new Error('child_process not implemented'); },
  fork: () => { throw new Error('child_process not implemented'); },
};
