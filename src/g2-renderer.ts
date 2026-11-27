// Formats glanceable 576x288 monochrome-green screens for Even Realities G2:
// - Top Text Container (576x142): primary multi-venue table or alert banner
// - Bottom-Left Text Container (366x96): live session / voice / safety status
// - Bottom-Right Image Container (200x96): 4-bit micro-LED sparkline / bars / gauge
// - Persistent Footer Container (576x36): temple / R1 ring gesture legend

import { bestPrice, type MarketState, SYMBOLS } from './exchanges'
import { computePositions, type PaperState } from './paper'

export type HudView = 'MARKETS' | 'POSITIONS' | 'SPREADS' | 'ALERTS'
export const HUD_VIEWS: HudView[] = ['MARKETS', 'POSITIONS', 'SPREADS', 'ALERTS']

function fmtPx(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '--'
  if (v >= 1000) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`
  return `$${v.toFixed(2)}`
}

function fmtSignedPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '--'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function fmtSignedUsd(v: number): string {
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v >= 0 ? '+' : '-'}$${abs}`
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length)
}

export interface HudFrame {
  body: string
  status: string
  footer: string
}

export function renderHudFrame(
  view: HudView,
  market: MarketState,
  paper: PaperState,
  opts?: { voiceListening?: boolean; lastTranscript?: string | null; nowMs?: number },
): HudFrame {
  const viewIdx = HUD_VIEWS.indexOf(view) + 1
  const nowMs = opts?.nowMs ?? Date.now()

  // High-priority Default-NO Safety Gate overlay
  if (paper.activeBanner) {
    const b = paper.activeBanner
    const remainSec = Math.max(0, Math.ceil((b.expiresAt - nowMs) / 1000))
    const noMark = b.selectedOption === 'NO' ? '>> [NO] CANCEL <<' : '   [NO] Cancel   '
    const yesMark = b.selectedOption === 'YES' ? '>> [YES] EXECUTE <<' : '   [YES] Execute   '
    const body = [
      `[!] SAFETY GATE (${remainSec}s) · DEFAULT-NO`,
      b.title,
      '----------------------------------------',
      b.detail,
      `${noMark}   ${yesMark}`,
    ].join('\n')
    const status = [
      'WRITE PROTECTION ACTIVE',
      'Swipe: Toggle [NO]/[YES]',
      'Tap: Confirm highlighted',
      'Auto-cancels in ' + remainSec + 's',
    ].join('\n')
    const footer = 'SAFETY GATE · Swipe: NO/YES · Tap: Confirm · 2xTap: Exit'
    return { body, status, footer }
  }

  const timeStr = market.updatedAt
    ? new Date(market.updatedAt).toLocaleTimeString('en-US', { hour12: false })
    : 'syncing...'
  const feedMode = market.wsConnected ? 'WS' : 'REST'
  const { open, sessionTotal } = computePositions(paper, market)
  const venueCount = Object.values(market.sourcesOk).filter(Boolean).length

  const statusLines = [
    opts?.voiceListening
      ? 'MIC: LISTENING (16kHz PCM)'
      : `FEEDS: ${venueCount}/4 LIVE (${feedMode})`,
    `SESSION: ${fmtSignedUsd(sessionTotal)} (${open.length} OPEN)`,
    opts?.lastTranscript
      ? `VOICE: "${opts.lastTranscript.slice(0, 22)}"`
      : paper.lastActionToast
        ? `> ${paper.lastActionToast.slice(0, 28)}`
        : 'VOICE: "Reduce BTC 50%"',
  ]
  const status = statusLines.join('\n')

  if (view === 'MARKETS') {
    const lines = [
      `EVENPULSE MARKETS     ${feedMode} ${timeStr}`,
      'ASSET  SPOT(BIN)    24H      HL FUND APR',
      '----------------------------------------',
    ]
    for (const sym of SYMBOLS) {
      const a = market.assets[sym]
      const px = fmtPx(bestPrice(a))
      const chg = fmtSignedPct(a.binanceChange24h)
      const fund = a.fundingAprPct !== null ? `${a.fundingAprPct >= 0 ? '+' : ''}${a.fundingAprPct.toFixed(1)}%` : '--'
      lines.push(`${pad(sym, 6)} ${pad(px, 12)} ${pad(chg, 8)} ${fund}`)
    }
    return {
      body: lines.join('\n'),
      status,
      footer: `[${viewIdx}/4] MARKETS · Tap: Refresh · Swipe: View · 2xTap: Exit`,
    }
  }

  if (view === 'POSITIONS') {
    const lines = [
      `POSITIONS & RISK     ${fmtSignedUsd(sessionTotal)}`,
      'POS         MARK        PnL       LIQ%',
      '----------------------------------------',
    ]
    if (open.length === 0) {
      lines.push('All paper positions flat.')
      lines.push(`Realized: ${fmtSignedUsd(paper.realizedSessionPnl)}`)
    } else {
      for (const item of open.slice(0, 3)) {
        const tag = `${item.pos.symbol} ${item.pos.side[0]}${item.pos.leverage}x`
        const pnl = fmtSignedUsd(item.unrealizedPnl)
        const liq = `${item.liqDistPct.toFixed(1)}%`
        lines.push(`${pad(tag, 11)} ${pad(fmtPx(item.mark), 11)} ${pad(pnl, 9)} ${liq}`)
      }
    }
    return {
      body: lines.join('\n'),
      status,
      footer: `[${viewIdx}/4] POSITIONS · Tap: Next · Swipe: View · 2xTap: Exit`,
    }
  }

  if (view === 'SPREADS') {
    const lines = [
      `4-VENUE SPREADS       ${feedMode} ${timeStr}`,
      'ASSET  BINANCE     REF(CB/OKX)  SPREAD',
      '----------------------------------------',
    ]
    for (const sym of SYMBOLS) {
      const a = market.assets[sym]
      const refPx = a.coinbasePrice ?? a.okxPrice ?? a.hyperliquidMark
      const spr =
        a.spreadBps !== null
          ? `${a.spreadBps >= 0 ? '+' : ''}${a.spreadBps.toFixed(1)}bp`
          : '--'
      lines.push(`${pad(sym, 6)} ${pad(fmtPx(a.binancePrice), 11)} ${pad(fmtPx(refPx), 12)} ${spr}`)
    }
    return {
      body: lines.join('\n'),
      status,
      footer: `[${viewIdx}/4] SPREADS · Tap: Next · Swipe: View · 2xTap: Exit`,
    }
  }

  const activeCount = paper.alerts.filter(a => !a.acknowledged).length
  const lines = [
    `ALERTS & VOICE ACTIONS (${activeCount} ARMED)`,
    '----------------------------------------',
  ]
  for (const al of paper.alerts.slice(0, 4)) {
    const badge = al.acknowledged ? '[OK]  ' : al.triggered ? '[HIT!]' : '[ARM] '
    lines.push(`${badge} ${al.label}`)
  }
  return {
    body: lines.join('\n'),
    status,
    footer: `[${viewIdx}/4] ALERTS · Tap: Next · Swipe: View · 2xTap: Exit`,
  }
}
