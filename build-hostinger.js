// Hostinger needs a Node server to receive SCMS athletes. Never strip API routes.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['scripts/build-server.mjs'], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
