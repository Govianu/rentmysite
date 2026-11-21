// PM2 process file for the VPS: pm2 start ecosystem.config.js && pm2 save
// Settings come from .env in this folder (loaded by server.js), so no secrets live here.
module.exports = {
  apps: [{
    name: 'rentmysite',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,            // one instance: rate limits and the lesson-video worker live in memory
    exec_mode: 'fork',
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production' }
  }]
};
