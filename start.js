const { execSync } = require('child_process');
const path = require('path');

process.chdir(path.join(__dirname));
require('./server.js');
