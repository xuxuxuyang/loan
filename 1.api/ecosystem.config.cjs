/**
 * PM2 生产启动（在 /var/1bossapi 目录执行）：
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * 查看崩溃原因：pm2 logs bossapi --lines 80
 */
module.exports = {
  apps: [
    {
      name: 'bossapi',
      cwd: __dirname,
      script: 'src/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '3110',
      },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      error_file: '/var/log/pm2/bossapi-error.log',
      out_file: '/var/log/pm2/bossapi-out.log',
      merge_logs: true,
      time: true,
    },
  ],
}
