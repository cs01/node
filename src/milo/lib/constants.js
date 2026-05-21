// constants module (deprecated, re-exports from os/fs)
'use strict';
module.exports = { ...require('os').constants, ...require('fs').constants };
