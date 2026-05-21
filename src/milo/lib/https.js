// https module — stub
'use strict';
const http = require('http');
module.exports = { ...http, globalAgent: new http.Agent() };
