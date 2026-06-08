import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import type { Item } from './products.js'

export type AppSettings = {
  automationRunning: boolean
  mlEnabled: boolean
  amazonEnabled: boolean
  amazonTag: string
  sendIntervalMinutes: number
  sendIntervalPool: number[]
  useIntervalPool: boolean
  activeHoursStart: number
  activeHoursEnd: number
  feedCount: number
  amazonFeedCount: number
  feedAmHour: number
  feedPmHour: number
  feedReactiveThreshold: number
  autoFeedEnabled: boolean
}

const settingsFile = path.join(config.dataDir, 'settings.json')

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function sanitizePool(pool: unknown): number[] {
  if (!Array.isArray(pool)) return [11, 7, 15]
  const nums = pool.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
  return nums.length ? nums : [11, 7, 15]
}

function defaultsFromEnv(): AppSettings {
  return {
    automationRunning: false,
    mlEnabled: true,
    amazonEnabled: Boolean(config.amazonTag),
    amazonTag: config.amazonTag,
    sendIntervalMinutes: config.intervalMin,
    sendIntervalPool: config.intervalPoolMin.length ? config.intervalPoolMin : [config.intervalMin],
    useIntervalPool: config.intervalPoolMin.length > 0,
    activeHoursStart: config.activeStart,
    activeHoursEnd: config.activeEnd,
    feedCount: config.feedCount,
    amazonFeedCount: config.amazonFeedCount,
    feedAmHour: config.feedAmHour,
    feedPmHour: config.feedPmHour,
    feedReactiveThreshold: 3,
    autoFeedEnabled: true,
  }
}

export function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const d = defaultsFromEnv()
  const s = raw ?? {}
  return {
    automationRunning: s.automationRunning === true,
    mlEnabled: s.mlEnabled !== false,
    amazonEnabled: s.amazonEnabled === true,
    amazonTag: String(s.amazonTag ?? d.amazonTag).trim(),
    sendIntervalMinutes: clamp(Number(s.sendIntervalMinutes ?? d.sendIntervalMinutes), 1, 1440),
    sendIntervalPool: sanitizePool(s.sendIntervalPool),
    useIntervalPool: s.useIntervalPool !== false,
    activeHoursStart: clamp(Number(s.activeHoursStart ?? d.activeHoursStart), 0, 23),
    activeHoursEnd: clamp(Number(s.activeHoursEnd ?? d.activeHoursEnd), 1, 24),
    feedCount: clamp(Number(s.feedCount ?? d.feedCount), 0, 100),
    amazonFeedCount: clamp(Number(s.amazonFeedCount ?? d.amazonFeedCount), 0, 100),
    feedAmHour: clamp(Number(s.feedAmHour ?? d.feedAmHour), 0, 23),
    feedPmHour: clamp(Number(s.feedPmHour ?? d.feedPmHour), 0, 23),
    feedReactiveThreshold: clamp(Number(s.feedReactiveThreshold ?? d.feedReactiveThreshold), 0, 50),
    autoFeedEnabled: s.autoFeedEnabled !== false,
  }
}

/** Le settings do disco (re-lido a cada tick — mudancas no painel aplicam sem reiniciar). */
export function readSettings(): AppSettings {
  try {
    const data = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Partial<AppSettings>
    return normalizeSettings(data)
  } catch {
    return defaultsFromEnv()
  }
}

/** Worker sempre inicia pausado — o usuario precisa clicar Iniciar no painel web. */
export function pauseAutomationOnBoot(): void {
  try {
    let raw: Record<string, unknown> = {}
    try {
      raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
    } catch {
      /* arquivo novo */
    }
    raw.automationRunning = false
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(settingsFile, JSON.stringify(normalizeSettings(raw as Partial<AppSettings>), null, 2))
  } catch {
    /* nao bloqueia o worker */
  }
}

/** Tag de afiliado Amazon (painel web; fallback .env no 1o boot). */
export function getAmazonTag(): string {
  return readSettings().amazonTag.trim()
}

export function isMlLink(link: string, productUrl?: string | null): boolean {
  const src = `${link} ${productUrl ?? ''}`
  return /meli\.|mercadolivre/i.test(src)
}

export function isAmazonLink(link: string, productUrl?: string | null): boolean {
  const src = `${link} ${productUrl ?? ''}`
  return /amazon\.com/i.test(src)
}

/** Item permitido pelos toggles de plataforma. Links manuais de outras lojas passam. */
export function isItemAllowed(it: Item, s: AppSettings): boolean {
  if (isMlLink(it.link, it.productUrl) && !s.mlEnabled) return false
  if (isAmazonLink(it.link, it.productUrl) && !s.amazonEnabled) return false
  return true
}

export function withinActiveHours(s: AppSettings): boolean {
  const h = new Date().getHours()
  return h >= s.activeHoursStart && h < s.activeHoursEnd
}

export function intervalPool(s: AppSettings): number[] {
  if (s.useIntervalPool && s.sendIntervalPool.length) return s.sendIntervalPool
  return [s.sendIntervalMinutes]
}
