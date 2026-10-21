// Screenshots of the board for the README, taken with headless Chrome over
// its DevTools protocol (a raw WebSocket; no npm dependency), against the
// running instance:
//
//   npm run screenshots            (writes docs/screenshots/*.png)
//
// BAROMETER_URL picks another instance (the default is the preview on :8510).
// Needs Google Chrome at the usual macOS path, or CHROME=/path/to/chrome.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.BAROMETER_URL ?? 'http://127.0.0.1:8510'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = 'docs/screenshots'
const PORT = Number(process.env.CHROME_PORT ?? 9336)

const PHONE = { width: 430, height: 932, scale: 2, mobile: true }
const DESKTOP = { width: 1200, height: 1500, scale: 2, mobile: false }

const scenarios = [
  { name: 'board-phone', view: PHONE, steps: [['wait', 2500]] },
  { name: 'board-phone-more', view: PHONE, steps: [['wait', 2500], ['scroll', '.dash', 1750]] },
  { name: 'board-phone-graphs', view: PHONE, steps: [['wait', 2500], ['scroll', '.dash', 2700]] },
  { name: 'board-desktop', view: DESKTOP, steps: [['wait', 2500]] },
  { name: 'settings-phone', view: PHONE, steps: [['wait', 2000], ['aria', 'Settings'], ['wait', 600]] },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function withChrome(view, fn) {
  const profile = mkdtempSync(join(tmpdir(), 'barometer-shots-'))
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', `--window-size=${view.width},${view.height}`, '--hide-scrollbars', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  const exited = new Promise((r) => chrome.on('exit', r))
  try {
    let targets = []
    for (let i = 0; i < 40 && targets.length === 0; i++) {
      await sleep(250)
      try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch { /* not up yet */ }
    }
    const page = targets.find((t) => t.type === 'page')
    if (!page) throw new Error('Chrome did not expose a page target')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    let id = 0
    const pending = new Map()
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
    const send = (method, params = {}) => new Promise((resolve) => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })) })
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
    await send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: view.scale, mobile: view.mobile })
    await fn({ send, evaluate })
    ws.close()
  } finally {
    chrome.kill()
    await exited
    rmSync(profile, { recursive: true, force: true })
  }
}

async function run(scenario) {
  await withChrome(scenario.view, async ({ send, evaluate }) => {
    await send('Page.navigate', { url: URL })
    await sleep(1500)
    for (const [op, a, b] of scenario.steps) {
      if (op === 'wait') await sleep(a)
      if (op === 'aria') await evaluate(`(() => { const el = document.querySelector('[aria-label=${JSON.stringify(a)}]'); if (!el) return 'missing'; el.click(); return 'ok' })()`)
      if (op === 'scroll') await evaluate(`(() => { window.scrollBy(0, ${b}); return 'ok' })()`)
      if (op !== 'wait') await sleep(300)
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(OUT, { recursive: true })
    writeFileSync(`${OUT}/${scenario.name}.png`, Buffer.from(shot.result.data, 'base64'))
    console.log(`wrote ${OUT}/${scenario.name}.png`)
  })
}

const only = process.argv[2]
for (const s of scenarios) {
  if (only && s.name !== only) continue
  await run(s)
}
