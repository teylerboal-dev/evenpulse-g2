// Formats glanceable 576x288 monochrome-green screens for Even Realities G2.

import { bestPrice, MarketState, SYMBOLS } from './exchanges'
import { computePositions, PaperState } from './paper'

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

export function renderHudFrame(
  view: HudView,
  market: MarketState,
  paper: PaperState,
): { body: string; footer: string } {
  const viewIdx = HUD_VIEWS.indexOf(view) + 1

  // High-priority glanceable alert overlay (1-tap confirm on G2)
  if (paper.activeBanner) {
    const b = paper.activeBanner
    const body = [
      '========================================',
      `[!] ${b.title}`,
      '----------------------------------------',
      b.detail,
      '',
      `>>> ${b.actionLabel} <<<`,
      '========================================',
    ].join('\n')
    const footer = `ALERT OVERLAY · Tap: Confirm · 2xTap: Exit`
    return { body, footer }
  }

  const timeStr = market.updatedAt
    ? new Date(market.updatedAt).toLocaleTimeString('en-US', { hour12: false })
    : 'syncing...'

  if (view === 'MARKETS') {
    const lines = [
      `EVENPULSE MARKETS          LIVE ${timeStr}`,
      'ASSET   SPOT(BIN)     24H      FUND(APR)',
      '----------------------------------------',
    ]
    for (const sym of SYMBOLS) {
      const a = market.assets[sym]
      const px = fmtPx(bestPrice(a))
      const chg = fmtSignedPct(a.binanceChange24h)
      const fund = a.fundingAprPct !== null ? `${a.fundingAprPct >= 0 ? '+' : ''}${a.fundingAprPct.toFixed(1)}%` : '--'
      lines.push(`${pad(sym, 7)} ${pad(px, 13)} ${pad(chg, 8)} ${fund}`)
    }
    if (paper.lastActionToast) {
      lines.push(`> ${paper.lastActionToast}`)
    }
    return {
      body: lines.join('\n'),
      footer: `[${viewIdx}/4] MARKETS · Tap: Refresh · Swipe: View · 2xTap: Exit`,
    }
  }

  if (view === 'POSITIONS') {
    const { open, sessionTotal } = computePositions(paper, market)
    const lines = [
      `SESSION PnL: ${fmtSignedUsd(sessionTotal)}     (PAPER)`,
      'POS          MARK        PnL       LIQ%',
      '----------------------------------------',
    ]
    if (open.length === 0) {
      lines.push('All paper positions closed.')
      lines.push(`Realized Session PnL: ${fmtSignedUsd(paper.realizedSessionPnl)}`)
    } else {
      for (const item of open.slice(0, 3)) {
        const tag = `${item.pos.symbol} ${item.pos.side[0]}${item.pos.leverage}x`
        const pnl = fmtSignedUsd(item.unrealizedPnl)
        const liq = `${item.liqDistPct.toFixed(1)}%`
        lines.push(`${pad(tag, 12)} ${pad(fmtPx(item.mark), 11)} ${pad(pnl, 9)} ${liq}`)
      }
    }
    if (paper.lastActionToast) {
      lines.push(`> ${paper.lastActionToast}`)
    }
    return {
      body: lines.join('\n'),
      footer: `[${viewIdx}/4] POSITIONS · Tap: Next · Swipe: View · 2xTap: Exit`,
    }
  }

  if (view === 'SPREADS') {
    const lines = [
      `CROSS-EXCHANGE SPREADS     LIVE ${timeStr}`,
      'ASSET  BINANCE      COINBASE     SPREAD',
      '----------------------------------------',
    ]
    for (const sym of SYMBOLS) {
      const a = market.assets[sym]
      const cbOrHl = a.coinbasePrice ?? a.hyperliquidMark
      const spr =
        a.spreadBps !== null
          ? `${a.spreadBps >= 0 ? '+' : ''}${a.spreadBps.toFixed(1)}bp`
          : '--'
      lines.push(`${pad(sym, 6)} ${pad(fmtPx(a.binancePrice), 12)} ${pad(fmtPx(cbOrHl), 12)} ${spr}`)
    }
    return {
      body: lines.join('\n'),
      footer: `[${viewIdx}/4] SPREADS · Tap: Next · Swipe: View · 2xTap: Exit`,
    }
  }

  // ALERTS view
  const lines = [
    `EXCHANGE ALERTS (${paper.alerts.filter(a => !a.acknowledged).length} ACTIVE)`,
    '----------------------------------------',
  ]
  for (const al of paper.alerts.slice(0, 4)) {
    const status = al.acknowledged ? '[OK]  ' : al.triggered ? '[HIT!]' : '[ARM] '
    lines.push(`${status} ${al.label}`)
  }
  lines.push('')
  lines.push('Tip: Tap to cycle · Companion: Test TP')
  return {
    body: lines.join('\n'),
    footer: `[${viewIdx}/4] ALERTS · Tap: Next · Swipe: View · 2xTap: Exit`,
  }
}
