import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

const stateFile = path.join(config.dataDir, '.state.json')

export type State = {
  sent: string[] // links de afiliado ja enviados (cada produto sai 1x)
  seenProducts: string[] // ids MLB ja processados pela descoberta (nao reprocessa)
  lastFeed: { date: string; am: boolean; pm: boolean } // controle dos 2 slots/dia
}

function empty(): State {
  return { sent: [], seenProducts: [], lastFeed: { date: '', am: false, pm: false } }
}

/** Le estado. Sem arquivo (ou formato antigo) = comeca zerado. */
export function readState(): State {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    return {
      sent: Array.isArray(s.sent) ? s.sent.map(String) : [],
      seenProducts: Array.isArray(s.seenProducts) ? s.seenProducts.map(String) : [],
      lastFeed: {
        date: String(s.lastFeed?.date ?? ''),
        am: Boolean(s.lastFeed?.am),
        pm: Boolean(s.lastFeed?.pm),
      },
    }
  } catch {
    return empty()
  }
}

/** Persiste estado (sobrevive a reinicio do worker). */
export function writeState(s: State): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(s, null, 2))
}

/** Chave estavel de um link pra marcar como enviado. */
export function linkKey(link: string): string {
  return link.trim()
}
