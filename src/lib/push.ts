import { api } from './api.ts'

/**
 * Push notifications to this device. A phone must have the app on its home
 * screen (iOS allows push only there); the browser asks once for permission.
 */

export type PushState = 'unsupported' | 'denied' | 'on' | 'off'

const supported = (): boolean => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(base64url: string): Uint8Array {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const { key } = await api.pushKey()
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource })
  await api.subscribePush(sub.toJSON())
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await api.unsubscribePush(sub.endpoint).catch(() => { /* the server may already have forgotten it */ })
    await sub.unsubscribe()
  }
  return 'off'
}
