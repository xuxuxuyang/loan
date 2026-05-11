const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { pathToFileURL } = require('url')
const puppeteer = require('puppeteer-core')
const { buildCardPackageContractViewHtml } = require('./cardPackageContractViewHtml')

/** 无界面 --print-to-pdf 超时（毫秒）；首次生成可能接近该值，Nginx proxy_read_timeout 须明显大于此值 */
function cardPackagePdfCliTimeoutMs() {
  const raw = String(process.env.CARD_PACKAGE_PDF_CLI_TIMEOUT_MS || '').trim()
  const n = raw ? Number(raw) : NaN
  if (Number.isFinite(n) && n >= 15_000 && n <= 600_000) {
    return Math.floor(n)
  }
  return 120_000
}

function resolveBrowserExecutableForPdf() {
  const fromEnv = String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim()
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv
  }
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c
      }
    }
  }
  if (process.platform === 'darwin') {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    if (fs.existsSync(mac)) {
      return mac
    }
  }
  if (process.platform === 'linux') {
    const linux = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']
    for (const c of linux) {
      if (fs.existsSync(c)) {
        return c
      }
    }
  }
  return undefined
}

async function resolvePuppeteerLaunchOptions() {
  const systemOrEnv = resolveBrowserExecutableForPdf()
  if (systemOrEnv) {
    return {
      executablePath: systemOrEnv,
      launchOptions: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    }
  }

  if (process.platform === 'linux' && String(process.env.CARD_PACKAGE_PDF_NO_SPARTICUZ || '').trim() !== '1') {
    const chromium = require('@sparticuz/chromium')
    const executablePath = await chromium.executablePath()
    return {
      executablePath,
      launchOptions: {
        headless: chromium.headless,
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
      },
    }
  }

  throw new Error(
    '无法生成 PDF：未找到 Chrome/Chromium。请在服务器设置 PUPPETEER_EXECUTABLE_PATH，'
      + '或（Linux）确保已安装 @sparticuz/chromium 且未设置 CARD_PACKAGE_PDF_NO_SPARTICUZ=1。',
  )
}

function isPuppeteerTransientCrash(err) {
  const msg = err && err.message ? String(err.message) : ''
  return /Target closed|Protocol error|setAutoAttach|setDiscoverTargets|Session closed|Browser closed|Browser disconnected|Navigation failed/i.test(msg)
}

/**
 * 不经过 Puppeteer/CDP，直接调 Chromium 的 --print-to-pdf（与 @sparticuz/chromium 兼容性更好）。
 */
async function spawnChromePrintToPdf(executablePath, htmlPath, pdfPath, timeoutMs) {
  const fileUrl = pathToFileURL(htmlPath).href
  const headlessVariants = [['--headless=new'], ['--headless']]
  let last = null
  for (const head of headlessVariants) {
    const args = [
      ...head,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--print-to-pdf=${pdfPath}`,
      fileUrl,
    ]
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(executablePath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stderr = ''
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString()
        })
        const t = setTimeout(() => {
          try {
            child.kill('SIGTERM')
          }
          catch (_) { /* ignore */ }
          reject(new Error(`print-to-pdf 超时（${timeoutMs}ms）`))
        }, timeoutMs)
        child.on('error', (e) => {
          clearTimeout(t)
          reject(e)
        })
        child.on('exit', (code) => {
          clearTimeout(t)
          if (code === 0) {
            resolve()
          }
          else {
            reject(new Error(`print-to-pdf 退出码 ${code}: ${stderr.slice(0, 1200)}`))
          }
        })
      })
      return
    }
    catch (e) {
      last = e
    }
  }
  throw last || new Error('print-to-pdf 失败')
}

async function renderPdfViaHeadlessCli(html) {
  const { executablePath } = await resolvePuppeteerLaunchOptions()
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error('未找到 Chromium 可执行文件')
  }
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mall-cpdf-'))
  const htmlPath = path.join(tmpDir, 'contract.html')
  const pdfPath = path.join(tmpDir, 'out.pdf')
  try {
    await fs.promises.writeFile(htmlPath, html, 'utf8')
    await spawnChromePrintToPdf(executablePath, htmlPath, pdfPath, cardPackagePdfCliTimeoutMs())
    return await fs.promises.readFile(pdfPath)
  }
  finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function renderPdfViaPuppeteer(html) {
  const { executablePath, launchOptions } = await resolvePuppeteerLaunchOptions()
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath,
      ...launchOptions,
    })
    const page = await browser.newPage()
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      const buf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
      })
      return Buffer.from(buf)
    }
    finally {
      await page.close().catch(() => {})
    }
  }
  finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}

/**
 * 将卡包合同 HTML 渲染为 PDF。优先 Puppeteer（版式可控）；若出现 CDP / Target closed 等，
 * 再回退到 Chromium --print-to-pdf（不经 DevTools，线上 @sparticuz 更稳）。
 *
 * 可设置 CARD_PACKAGE_PDF_PREFER_CLI=1 仅用命令行；Linux 默认 CARD_PACKAGE_PDF_LINUX_CLI_FIRST=1 先命令行（可设为 0 关闭）。
 *
 * @param {Parameters<typeof buildCardPackageContractViewHtml>[0]} params
 * @returns {Promise<Buffer>}
 */
async function buildCardPackageContractPdfBuffer(params) {
  const html = buildCardPackageContractViewHtml({
    ...params,
    forPdfSnapshot: true,
  })

  const preferCli = String(process.env.CARD_PACKAGE_PDF_PREFER_CLI || '').trim() === '1'
  /** Linux + @sparticuz 下 Puppeteer CDP 易报 Target closed；默认先尝试无 CDP 的 print-to-pdf */
  const linuxCliFirst = process.platform === 'linux'
    && String(process.env.CARD_PACKAGE_PDF_LINUX_CLI_FIRST || '1').trim() === '1'

  if (preferCli) {
    return await renderPdfViaHeadlessCli(html)
  }

  if (linuxCliFirst) {
    try {
      return await renderPdfViaHeadlessCli(html)
    }
    catch (_) {
      /* 再尝试 Puppeteer */
    }
  }

  let lastErr = null
  try {
    return await renderPdfViaPuppeteer(html)
  }
  catch (err) {
    lastErr = err
    if (isPuppeteerTransientCrash(err)) {
      try {
        return await renderPdfViaPuppeteer(html)
      }
      catch (err2) {
        lastErr = err2
      }
    }
  }

  try {
    return await renderPdfViaHeadlessCli(html)
  }
  catch (cliErr) {
    const a = lastErr && lastErr.message ? String(lastErr.message) : String(lastErr)
    const b = cliErr && cliErr.message ? String(cliErr.message) : String(cliErr)
    throw new Error(`PDF 生成失败（Puppeteer: ${a}；无界面打印: ${b}）`)
  }
}

module.exports = {
  buildCardPackageContractPdfBuffer,
}
