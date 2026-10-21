import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { appErrors, backupStatus, dataFileStatus, isErrorLine, describeOmlx, describeSpeech, parseBackupLog, parseDf, parseLaunchd, parseModels, parsePressure, parseRoute, parseTailscale, parseTherm, parseVmStat, parseWatchLines, pickProbeModel, watchLog } from './probes.ts'

describe('parsers', () => {
  it('reads launchctl print', () => {
    const text = 'com.amie.orrery = {\n\tactive count = 1\n\tpath = /x\n\tstate = running\n\n\tprogram = /bin/npm\n\tpid = 11140\n\truns = 40\n\tlast exit code = 143\n}\n'
    expect(parseLaunchd(text)).toEqual({ pid: 11140, runs: 40, lastExit: 143, state: 'running' })
    expect(parseLaunchd('')).toBeNull()
  })

  it('reads vm_stat, df, the pressure level, pmset and the default route', () => {
    expect(parseVmStat('Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                                   243531.\nPages active:                                2738985.\nPages wired down:                            1000000.\n'))
      .toEqual({ freeBytes: 243531 * 16384, wiredBytes: 1000000 * 16384 })
    expect(parseDf('Filesystem   1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s1s1   971350180  13339132 114616076    11%  484019 1146160760    0%   /\n'))
      .toEqual({ diskTotalBytes: 971350180 * 1024, diskFreeBytes: 114616076 * 1024 })
    expect(parseDf('')).toEqual({ diskTotalBytes: null, diskFreeBytes: null })
    expect(parsePressure('1\n')).toBe('normal')
    expect(parsePressure('2')).toBe('warning')
    expect(parsePressure('4')).toBe('critical')
    expect(parsePressure('')).toBe('unknown')
    expect(parseTherm('Note: No thermal warning level has been recorded\n')).toBe('ok')
    expect(parseTherm('CPU_Scheduler_Limit\t= 100\nCPU_Available_CPUs\t= 12\nCPU_Speed_Limit\t= 68\n')).toBe('warning')
    expect(parseTherm('')).toBe('unknown')
    expect(parseRoute('   route to: default\ndestination: default\n  interface: en1\n')).toBe('en1')
  })

  it('reads tailscale status', () => {
    const up = JSON.stringify({ BackendState: 'Running', Self: { Online: true, HostName: 'Studio', DNSName: 'studio.tail.ts.net.' }, Peer: { a: { Online: true }, b: { Online: false } } })
    expect(parseTailscale(up)).toEqual({ state: 'ok', backend: 'Running', online: true, hostName: 'Studio', dnsName: 'studio.tail.ts.net', peers: 2, peersOnline: 1 })
    expect(parseTailscale(JSON.stringify({ BackendState: 'Stopped', Self: { Online: false } })).state).toBe('down')
    expect(parseTailscale(JSON.stringify({ BackendState: 'Running', Self: { Online: false } })).state).toBe('warn')
    expect(parseTailscale('').state).toBe('unknown')
  })

  it('reads LM Studio\'s model list and picks the smallest loaded model to time', () => {
    const text = JSON.stringify({ models: [
      { key: 'qwen/qwen3.8-27b', type: 'llm', loaded_instances: [{ id: 'qwen/qwen3.8-27b', config: { context_length: 131072 } }] },
      { key: 'qwen/qwen3.5-9b', type: 'llm', loaded_instances: [{ id: 'qwen/qwen3.5-9b', config: { context_length: 65536 } }] },
      { key: 'other/big', type: 'llm', loaded_instances: [] },
      { key: 'nomic/embed', type: 'embedding', loaded_instances: [{ id: 'nomic/embed' }] },
    ] })
    const parsed = parseModels(text)
    expect(parsed).toEqual({ loaded: [{ id: 'qwen/qwen3.8-27b', contextLength: 131072 }, { id: 'qwen/qwen3.5-9b', contextLength: 65536 }], available: 3 })
    expect(pickProbeModel(parsed.loaded, '')).toBe('qwen/qwen3.5-9b')
    expect(pickProbeModel(parsed.loaded, 'qwen/qwen3.8')).toBe('qwen/qwen3.8-27b')
    expect(pickProbeModel(parsed.loaded, 'missing')).toBe('qwen/qwen3.5-9b')
    expect(pickProbeModel([], '')).toBeNull()
  })

  it('describes oMLX and the speech server', () => {
    expect(describeOmlx(JSON.stringify({ status: 'healthy', engine_pool: { model_count: 10, loaded_count: 1, current_model_memory: 30976279174 } }))).toBe('1 of 10 models loaded · 31 GB')
    expect(describeOmlx('nope')).toBeNull()
    expect(describeSpeech(JSON.stringify({ data: [{ id: 'mlx-community/Kokoro-82M-bf16' }] }))).toBe('Kokoro-82M-bf16')
  })

  it('judges a backup by its newest dated copy', () => {
    const now = new Date('2026-10-21T09:00:00').getTime()
    expect(backupStatus(['macros-2026-10-19.sqlite', 'macros-2026-10-21.sqlite', 'notes.txt'], 'macros', 26, now)).toEqual({ newest: '2026-10-21', ageHours: 9, state: 'ok' })
    expect(backupStatus(['macros-2026-10-19.sqlite'], 'macros', 26, now)).toMatchObject({ newest: '2026-10-19', state: 'warn' })
    expect(backupStatus(['lm-chat-2026-10-21.sqlite'], 'macros', 26, now)).toEqual({ newest: null, ageHours: null, state: 'down' })
  })

  it('reads the backup log\'s last run', () => {
    const log = '2026-10-19 00:00:04 ok   cairn/macros-2026-10-19.sqlite (592K)\n2026-10-19 00:00:06 finished: 6 copies\n2026-10-20 00:00:05 ok   cairn/macros-2026-10-20.sqlite (592K)\n2026-10-20 00:00:06 FAILED lm-chat/images rsync\n2026-10-20 00:00:06 finished with 1 failure(s)\n'
    expect(parseBackupLog(log)).toEqual({ lastRun: new Date('2026-10-20T00:00:06').toISOString(), failures: 1, state: 'warn' })
    expect(parseBackupLog(log.split('\n').slice(0, 2).join('\n'))).toMatchObject({ failures: 0, state: 'ok' })
    expect(parseBackupLog('')).toEqual({ lastRun: null, failures: 0, state: 'unknown' })
  })

  it('tells an error line from the rest of an app\'s log', () => {
    expect(isErrorLine('[engine] compaction skipped: The operation was aborted due to timeout')).toBe(true)
    expect(isErrorLine('[orrery] could not work out what to remember: 500')).toBe(true)
    expect(isErrorLine('Error: connect ECONNREFUSED 127.0.0.1:1234')).toBe(true)
    expect(isErrorLine('    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)')).toBe(false)
    expect(isErrorLine('  ➜  Local:   http://localhost:8410/')).toBe(false)
    expect(isErrorLine('[cairn] 3 lookups cached')).toBe(false)
  })

  it('reads services-watch\'s lines', () => {
    const text = '2026-10-20 14:53:08 whetstone restarted: signaled service: Terminated: 15; exited due to exit(143)\n2026-10-20 15:00:00 cairn stopped\nnoise\n'
    expect(parseWatchLines(text)).toEqual([
      { ts: new Date('2026-10-20T14:53:08').toISOString(), target: 'whetstone', what: 'restarted', reason: 'signaled service: Terminated: 15; exited due to exit(143)' },
      { ts: new Date('2026-10-20T15:00:00').toISOString(), target: 'cairn', what: 'stopped', reason: null },
    ])
  })
})

describe('on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barometer-probes-'))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('reads a database\'s size, counts and quick check, and its backups', () => {
    const file = path.join(dir, 'demo.sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE things (id INTEGER); INSERT INTO things VALUES (1), (2), (3)')
    db.close()
    fs.mkdirSync(path.join(dir, 'Backups', 'demo'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'Backups', 'demo', 'demo-2026-10-21.sqlite'), '')
    const target = { id: 'demo', name: 'Demo', file, backupDir: 'demo', backupPrefix: 'demo', counts: { things: 'SELECT COUNT(*) FROM things', broken: 'SELECT * FROM nowhere' } }
    const now = new Date('2026-10-21T08:00:00').getTime()
    const s = dataFileStatus(target, { check: true, maxHours: 26, backupsDir: path.join(dir, 'Backups'), now })
    expect(s).toMatchObject({ id: 'demo', file: 'demo.sqlite', counts: { things: 3 }, check: 'ok', backup: { newest: '2026-10-21', state: 'ok' } })
    expect(s.bytes).toBeGreaterThan(0)
    expect(s.error).toMatch(/Could not count broken in demo.sqlite/)
    const missing = dataFileStatus({ ...target, file: path.join(dir, 'gone.sqlite'), backupDir: 'none' }, { check: false, maxHours: 26, backupsDir: path.join(dir, 'Backups') })
    expect(missing).toMatchObject({ bytes: null, check: 'unknown', backup: { state: 'unknown' } })
    expect(missing.error).toMatch(/Backups: /)
  })

  it('reads an app\'s new error lines, starting near the end of a long log', () => {
    const file = path.join(dir, 'app.log')
    fs.writeFileSync(file, `${'x'.repeat(70_000)}\nold error line\nfine\nlookup failed: timeout\n`)
    const first = appErrors(file, 0, 1000)
    expect(first.lines).toEqual([{ ts: '1970-01-01T00:00:01.000Z', text: 'old error line' }, { ts: '1970-01-01T00:00:01.000Z', text: 'lookup failed: timeout' }])
    fs.appendFileSync(file, 'all good\nError: boom\n')
    expect(appErrors(file, first.offset).lines.map((l) => l.text)).toEqual(['Error: boom'])
  })

  it('reads the watch log from where it left off, and from the start after a truncation', () => {
    const file = path.join(dir, 'watch.log')
    fs.writeFileSync(file, '2026-10-20 14:53:08 whetstone restarted: x\n')
    const first = watchLog(0, file)
    expect(first.lines.map((l) => l.target)).toEqual(['whetstone'])
    fs.appendFileSync(file, '2026-10-20 15:00:00 cairn stopped\n')
    const second = watchLog(first.offset, file)
    expect(second.lines.map((l) => l.target)).toEqual(['cairn'])
    expect(watchLog(second.offset, file).lines).toEqual([])
    fs.writeFileSync(file, '2026-10-21 00:00:00 orrery restarted\n')
    expect(watchLog(second.offset, file).lines.map((l) => l.target)).toEqual(['orrery'])
    expect(watchLog(0, path.join(dir, 'missing.log'))).toEqual({ lines: [], offset: 0 })
  })
})
