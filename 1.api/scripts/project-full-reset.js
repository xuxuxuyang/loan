/**
 * 项目级「全量重置到初始化」——用于完整回归 / 联调测试，非局部清理。
 *
 * 会做：
 * 1. 清空整个 api/data 目录（不限于 db.json / db.*.json）
 * 2. 删除 api/public/generated（本地生成的合同 PDF 等缓存，不动 contracts 模板）
 * 3. 删除当前配置下 Mongo 中所有本项目库（根库 mall + mall__core + mall__self + mall__tenant_* 等）
 * 4. 重新写入最小种子：mall 根库 + mall__core + mall__self（与运行时 workspace 一致；users 默认为空，仅 adminAccounts 含内置超管）
 *
 * 使用前：停止 mall-api；执行后：重启 API；浏览器清除 mall-admin-session（或无痕重登）。
 *
 *   cd api && npm run reset:project
 *   （npm run fresh 与此相同）
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const apiRoot = path.join(__dirname, '..')
const dataDir = path.join(apiRoot, 'data')
const generatedDir = path.join(apiRoot, 'public', 'generated')

function wipeDirContents(dir, label) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(`[full-reset] ${label}：目录不存在，已创建空目录`)
    return
  }
  let n = 0
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    fs.rmSync(p, { recursive: true, force: true })
    n += 1
    console.log(`[full-reset] ${label} 已删除`, path.relative(apiRoot, p))
  }
  console.log(`[full-reset] ${label} 完成，共移除 ${n} 项`)
}

function main() {
  console.warn('')
  console.warn('[full-reset] ► 全量重置：将删除 Mongo 内全部 mall / mall__* 库并重写种子；本地 api/data 全部清空。')
  console.warn('[full-reset] ► 请勿在生产或共用 Mongo 实例上执行；请先停止 mall-api。')
  console.warn('')

  wipeDirContents(dataDir, 'api/data')
  if (fs.existsSync(generatedDir)) {
    fs.rmSync(generatedDir, { recursive: true, force: true })
    console.log('[full-reset] 已删除 api/public/generated')
  }

  const mongoScript = path.join(__dirname, 'mongo-bootstrap-only.js')
  const r = spawnSync(process.execPath, [mongoScript], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if (r.status !== 0 && r.status !== null) {
    process.exit(r.status)
  }
  if (r.error) {
    console.error('[full-reset]', r.error)
    process.exit(1)
  }

  console.warn('')
  console.warn('[full-reset] ✓ 已完成。请：① 启动 mall-api  ② 清除浏览器 localStorage（后台 mall-admin-session；H5 商城如有 token 一并清）')
  console.warn('')
}

main()
