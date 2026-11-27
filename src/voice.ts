// Natural short-phrase voice intent parser & 16kHz PCM RMS energy meter for Even G2.
// Runs 100% locally with zero external API keys.

import type { SymbolKey } from './exchanges'
import type { HudView } from './g2-renderer'

export type VoiceIntent =
  | { kind: 'NAVIGATE'; view: HudView; transcript: string }
  | { kind: 'REDUCE_HALF'; symbol?: SymbolKey; transcript: string }
  | { kind: 'CLOSE_POSITION'; symbol?: SymbolKey; transcript: string }
  | { kind: 'OPEN_PAPER'; symbol: SymbolKey; side: 'LONG' | 'SHORT'; qty: number; transcript: string }
  | { kind: 'ADD_PRICE_ALERT'; symbol: SymbolKey; condition: 'ABOVE' | 'BELOW'; threshold: number; transcript: string }
  | { kind: 'ADD_SPREAD_ALERT'; thresholdBps: number; transcript: string }
  | { kind: 'UNKNOWN'; transcript: string }

export const VOICE_PRESETS: string[] = [
  'Reduce BTC 50 percent',
  'Close ETH position',
  'Alert BTC above 95000',
  'Alert spread above 10 bps',
  'Show spreads',
]

function detectSymbol(text: string): SymbolKey | undefined {
  const lower = text.toLowerCase()
  if (/\b(btc|bitcoin)\b/.test(lower)) return 'BTC'
  if (/\b(eth|ethereum|ether)\b/.test(lower)) return 'ETH'
  if (/\b(sol|solana)\b/.test(lower)) return 'SOL'
  if (/\b(bnb|binance coin)\b/.test(lower)) return 'BNB'
  return undefined
}

export function parseVoiceCommand(raw: string): VoiceIntent {
  const transcript = raw.trim()
  const lower = transcript.toLowerCase()

  if (!lower) return { kind: 'UNKNOWN', transcript }

  // Navigation commands
  if (/\b(spread|spreads|premium|arb|basis)\b/.test(lower) && !/\balert\b/.test(lower)) {
    return { kind: 'NAVIGATE', view: 'SPREADS', transcript }
  }
  if (/\b(position|positions|pnl|portfolio|liq)\b/.test(lower) && !/\b(close|reduce|cut|trim)\b/.test(lower)) {
    return { kind: 'NAVIGATE', view: 'POSITIONS', transcript }
  }
  if (/\b(market|markets|prices|quotes|ticker)\b/.test(lower)) {
    return { kind: 'NAVIGATE', view: 'MARKETS', transcript }
  }
  if (/\b(show alerts|alerts view|open alerts)\b/.test(lower)) {
    return { kind: 'NAVIGATE', view: 'ALERTS', transcript }
  }

  // Spread alert command: e.g. "alert spread above 10 bps"
  if (/\balert\b/.test(lower) && /\bspread\b/.test(lower)) {
    const numMatch = lower.match(/(\d+(?:\.\d+)?)/)
    const thresholdBps = numMatch ? Number(numMatch[1]) : 10
    if (Number.isFinite(thresholdBps) && thresholdBps > 0) {
      return { kind: 'ADD_SPREAD_ALERT', thresholdBps, transcript }
    }
  }

  // Price alert command: e.g. "alert btc above 95000" or "notify eth below 2800"
  if (/\b(alert|notify|ping|watch)\b/.test(lower)) {
    const symbol = detectSymbol(lower) ?? 'BTC'
    const condition: 'ABOVE' | 'BELOW' = /\b(below|under|drops|less)\b/.test(lower) ? 'BELOW' : 'ABOVE'
    const cleaned = lower.replace(/,/g, '')
    const numMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(k)?\b/)
    if (numMatch) {
      const base = Number(numMatch[1])
      const threshold = numMatch[2] === 'k' ? base * 1000 : base
      if (Number.isFinite(threshold) && threshold > 0) {
        return { kind: 'ADD_PRICE_ALERT', symbol, condition, threshold, transcript }
      }
    }
  }

  // Reduce 50% command: e.g. "reduce btc half", "trim eth 50%", "cut sol half"
  if (/\b(reduce|trim|cut|half|50%|50 percent)\b/.test(lower)) {
    return { kind: 'REDUCE_HALF', symbol: detectSymbol(lower), transcript }
  }

  // Close position command: e.g. "close btc", "exit eth position", "take profit sol"
  if (/\b(close|exit|flatten|take profit|tp)\b/.test(lower)) {
    return { kind: 'CLOSE_POSITION', symbol: detectSymbol(lower), transcript }
  }

  // Open paper position: e.g. "long sol 10" or "short eth 2"
  if (/\b(long|buy|short|sell)\b/.test(lower)) {
    const symbol = detectSymbol(lower) ?? 'BTC'
    const side: 'LONG' | 'SHORT' = /\b(short|sell)\b/.test(lower) ? 'SHORT' : 'LONG'
    const numMatch = lower.match(/(\d+(?:\.\d+)?)/)
    const qty = numMatch ? Number(numMatch[1]) : symbol === 'BTC' ? 0.1 : symbol === 'ETH' ? 1 : 10
    if (Number.isFinite(qty) && qty > 0) {
      return { kind: 'OPEN_PAPER', symbol, side, qty, transcript }
    }
  }

  return { kind: 'UNKNOWN', transcript }
}

/** Compute normalized [0..1] audio energy from signed 16-bit little-endian PCM bytes (Even G2 mic). */
export function computePcmEnergy(pcm: Uint8Array): number {
  if (pcm.byteLength < 2) return 0
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const samples = Math.floor(pcm.byteLength / 2)
  let sumSq = 0
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true) / 32768
    sumSq += s * s
  }
  const rms = Math.sqrt(sumSq / samples)
  return Math.min(1, rms * 3.5)
}
