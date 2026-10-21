import os from 'node:os'
import path from 'node:path'

/**
 * What Barometer watches on this Mac. All of it is fixed by how the Mac is
 * set up (the launchd labels, the ports, where each app keeps its data), so
 * it lives here rather than in settings.
 */

export const HOME = os.homedir()
export const TAILNET = 'https://amies-mac-studio.tail1585ef.ts.net'

export interface AppTarget {
  id: string
  name: string
  port: number
  label: string
  url: string
}

export const APPS: AppTarget[] = [
  { id: 'lm-chat', name: 'LM Chat', port: 8010, label: 'com.amie.lm-chat', url: `${TAILNET}:8443` },
  { id: 'cairn', name: 'Cairn', port: 8210, label: 'com.amie.cairn', url: TAILNET },
  { id: 'whetstone', name: 'Whetstone', port: 8310, label: 'com.amie.whetstone', url: `${TAILNET}:8444` },
  { id: 'orrery', name: 'Orrery', port: 8410, label: 'com.amie.orrery', url: `${TAILNET}:8445` },
]

export interface ServiceTarget {
  id: string
  name: string
  /** Any answer from here means the service is up. */
  url: string
  label: string | null
  /** oMLX says what it has loaded on its health route. */
  kind: 'speech' | 'omlx'
}

export const SERVICES: ServiceTarget[] = [
  { id: 'speech', name: 'Speech (Kokoro)', url: 'http://127.0.0.1:8020/v1/models', label: 'com.amie.lm-speech', kind: 'speech' },
  { id: 'omlx', name: 'oMLX', url: 'http://127.0.0.1:8000/health', label: null, kind: 'omlx' },
]

export interface DataTarget {
  id: string
  name: string
  file: string
  /** The backup folder under Backups/ and the name its dated copies start with. */
  backupDir: string
  backupPrefix: string
  /** Row counts worth a glance, each a single-number query. */
  counts: Record<string, string>
}

export const DATA: DataTarget[] = [
  {
    id: 'lm-chat', name: 'LM Chat', file: path.join(HOME, 'Code/mobile-ai-chat/lm-chat/.data/lm-chat.sqlite'), backupDir: 'lm-chat', backupPrefix: 'lm-chat',
    counts: { chats: 'SELECT COUNT(*) FROM conversations', messages: 'SELECT COUNT(*) FROM messages' },
  },
  {
    id: 'cairn', name: 'Cairn', file: path.join(HOME, 'Code/cairn/.data/macros.sqlite'), backupDir: 'cairn', backupPrefix: 'macros',
    counts: { entries: 'SELECT COUNT(*) FROM entries', 'today': "SELECT COUNT(*) FROM entries WHERE date = date('now', 'localtime')", foods: 'SELECT COUNT(*) FROM foods' },
  },
  {
    id: 'whetstone', name: 'Whetstone', file: path.join(HOME, 'Code/interview-prep/.data/whetstone.sqlite'), backupDir: 'whetstone', backupPrefix: 'whetstone',
    counts: { reviews: 'SELECT COUNT(*) FROM reviews', problems: 'SELECT COUNT(*) FROM problems' },
  },
  {
    id: 'orrery', name: 'Orrery', file: path.join(HOME, 'Code/orrery/.data/orrery.sqlite'), backupDir: 'orrery', backupPrefix: 'orrery',
    counts: { castings: 'SELECT COUNT(*) FROM castings', questions: 'SELECT COUNT(*) FROM follow_ups' },
  },
  {
    id: 'lm-memory', name: 'Memory', file: path.join(HOME, '.lm-memory/memory.sqlite'), backupDir: 'lm-memory', backupPrefix: 'memory',
    counts: { memories: 'SELECT COUNT(*) FROM memories' },
  },
]

export const BACKUPS_DIR = path.join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs/Backups')
export const BACKUP_LOG = path.join(HOME, 'Library/Logs/backup-data.log')
export const WATCH_LOG = path.join(HOME, 'Library/Logs/services-watch.log')
export const TAILSCALE_BIN = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
