// PM2: pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [{
    name: 'govianu-hub',
    script: 'server.js',
    cwd: __dirname,
    instances: 1, // one instance: JSON store + timers live in this process
    exec_mode: 'fork',
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production' },
  }],
};
