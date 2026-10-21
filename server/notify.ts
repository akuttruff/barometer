import { execFile } from 'node:child_process'
import webPush from 'web-push'
import type { Severity } from '../src/types.ts'
import type { PushSubscription, Store } from './store.ts'
import { TAILNET } from './targets.ts'

/**
 * Saying so: a macOS notification on the Mac itself (the same way
 * services-watch does) and a Web Push to every phone that asked for one.
 * A phone whose subscription has lapsed is forgotten.
 */

export interface Notice {
  title: string
  body: string
  severity: Severity
}

export interface NotifierOptions {
  /** Shows the notification on the Mac; replaced in tests. */
  mac?: (n: Notice) => Promise<void>
  /** Sends one push; replaced in tests. Throws with `statusCode` 404 or 410 for a lapsed subscription. */
  push?: (sub: PushSubscription, payload: string, vapid: Vapid) => Promise<void>
}

export interface Vapid { publicKey: string; privateKey: string }

const SOUND: Record<Severity, string> = { info: 'Glass', warn: 'Funk', critical: 'Sosumi' }

const escape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export async function macNotification(n: Notice): Promise<void> {
  await new Promise<void>((resolve) => {
    execFile('/usr/bin/osascript', ['-e', `display notification "${escape(n.body)}" with title "${escape(n.title)}" sound name "${SOUND[n.severity]}"`], { timeout: 5000 }, () => resolve())
  })
}

export async function webPushSend(sub: PushSubscription, payload: string, vapid: Vapid): Promise<void> {
  await webPush.sendNotification(sub, payload, { vapidDetails: { subject: TAILNET, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 3600 })
}

export class Notifier {
  private readonly mac: NonNullable<NotifierOptions['mac']>
  private readonly push: NonNullable<NotifierOptions['push']>

  constructor(private readonly store: Store, options: NotifierOptions = {}) {
    this.mac = options.mac ?? macNotification
    this.push = options.push ?? webPushSend
  }

  /** The VAPID pair this server signs its pushes with, made once and kept. */
  vapid(): Vapid {
    const kept = this.store.getState('vapid')
    if (kept) return JSON.parse(kept) as Vapid
    const made = webPush.generateVAPIDKeys()
    this.store.setState('vapid', JSON.stringify(made))
    return made
  }

  async send(n: Notice): Promise<void> {
    const settings = this.store.getSettings()
    const jobs: Promise<void>[] = []
    if (settings.notifyMac) jobs.push(this.mac(n).catch(() => { /* the Mac's notification is a convenience */ }))
    const subs = this.store.subscriptions()
    if (subs.length) {
      const vapid = this.vapid()
      const payload = JSON.stringify({ title: n.title, body: n.body, severity: n.severity })
      for (const sub of subs) {
        jobs.push(this.push(sub, payload, vapid).catch((err: { statusCode?: number }) => {
          if (err.statusCode === 404 || err.statusCode === 410) this.store.removeSubscription(sub.endpoint)
        }))
      }
    }
    await Promise.all(jobs)
  }
}
