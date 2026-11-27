// Paper-trading positions, live session PnL, liquidation distance, and Default-NO
// 30-second expiring Safety Gate write actions for Even Realities G2.
// Strictly read-only public feeds + paper simulation — holds zero user funds or API keys.

import { bestPrice, type MarketState, type SymbolKey } from './exchanges'

export type Side = 'LONG' | 'SHORT'

export interface PaperPosition {
  id: string
  symbol: SymbolKey
  side: Side
  qty: number
  entryPrice: number
  leverage: number
  venue: 'Binance' | 'OKX' | 'Coinbase' | 'Hyperliquid'
  closedAt?: number
  realizedPnl?: number
}

export interface PriceAlert {
  id: string
  symbol: SymbolKey
  condition: 'ABOVE' | 'BELOW' | 'SPREAD_BPS_ABOVE'
  threshold: number
  label: string
  triggered: boolean
  acknowledged: boolean
}

export type SafetyActionKind = 'CLOSE_100' | 'REDUCE_50' | 'OPEN_PAPER' | 'ACK_ALERT' | 'ADD_ALERT'

export interface SafetyBanner {
  id: string
  kind: SafetyActionKind
  title: string
  detail: string
  selectedOption: 'NO' | 'YES' // Always defaults to NO to prevent accidental temple taps
  createdAt: number
  expiresAt: number
  positionId?: string
  alertId?: string
  draftOrder?: { symbol: SymbolKey; side: Side; qty: number; leverage: number }
  draftAlert?: Omit<PriceAlert, 'id' | 'triggered' | 'acknowledged'>
}

export interface AuditEntry {
  ts: number
  summary: string
}

export interface PaperState {
  positions: PaperPosition[]
  realizedSessionPnl: number
  alerts: PriceAlert[]
  activeBanner: SafetyBanner | null
  seededFromLive: boolean
  lastActionToast: string | null
  auditLog: AuditEntry[]
}

export const SAFETY_GATE_TTL_MS = 30_000

export function createInitialPaperState(): PaperState {
  return {
    positions: [],
    realizedSessionPnl: 0,
    alerts: [],
    activeBanner: null,
    seededFromLive: false,
    lastActionToast: null,
    auditLog: [],
  }
}

export function seedPaperFromLive(state: PaperState, market: MarketState): PaperState {
  if (state.seededFromLive) return state
  const btc = bestPrice(market.assets.BTC)
  const eth = bestPrice(market.assets.ETH)
  const sol = bestPrice(market.assets.SOL)
  if (!btc || !eth || !sol) return state

  const positions: PaperPosition[] = [
    {
      id: 'pos-btc',
      symbol: 'BTC',
      side: 'LONG',
      qty: 0.25,
      entryPrice: Number((btc * 0.986).toFixed(2)),
      leverage: 5,
      venue: 'Binance',
    },
    {
      id: 'pos-eth',
      symbol: 'ETH',
      side: 'LONG',
      qty: 3.0,
      entryPrice: Number((eth * 0.992).toFixed(2)),
      leverage: 4,
      venue: 'Hyperliquid',
    },
    {
      id: 'pos-sol',
      symbol: 'SOL',
      side: 'SHORT',
      qty: 20,
      entryPrice: Number((sol * 1.012).toFixed(2)),
      leverage: 3,
      venue: 'OKX',
    },
  ]

  const alerts: PriceAlert[] = [
    {
      id: 'al-btc',
      symbol: 'BTC',
      condition: 'ABOVE',
      threshold: Math.round(btc * 1.005),
      label: `BTC > $${Math.round(btc * 1.005).toLocaleString()}`,
      triggered: false,
      acknowledged: false,
    },
    {
      id: 'al-eth',
      symbol: 'ETH',
      condition: 'BELOW',
      threshold: Math.round(eth * 0.985),
      label: `ETH < $${Math.round(eth * 0.985).toLocaleString()}`,
      triggered: false,
      acknowledged: false,
    },
    {
      id: 'al-spread',
      symbol: 'BTC',
      condition: 'SPREAD_BPS_ABOVE',
      threshold: 8,
      label: 'BTC Venue Spread > 8 bps',
      triggered: false,
      acknowledged: false,
    },
  ]

  return {
    ...state,
    positions,
    alerts,
    seededFromLive: true,
  }
}

export interface ComputedPosition {
  pos: PaperPosition
  mark: number
  unrealizedPnl: number
  roePct: number
  liqPrice: number
  liqDistPct: number
}

export function computePositions(state: PaperState, market: MarketState): {
  open: ComputedPosition[]
  unrealizedTotal: number
  sessionTotal: number
} {
  const open: ComputedPosition[] = []
  let unrealizedTotal = 0

  for (const pos of state.positions) {
    if (pos.closedAt || pos.qty <= 0) continue
    const mark = bestPrice(market.assets[pos.symbol]) ?? pos.entryPrice
    const dir = pos.side === 'LONG' ? 1 : -1
    const unrealizedPnl = (mark - pos.entryPrice) * pos.qty * dir
    const margin = (pos.entryPrice * pos.qty) / pos.leverage
    const roePct = margin > 0 ? (unrealizedPnl / margin) * 100 : 0
    const liqPrice =
      pos.side === 'LONG'
        ? pos.entryPrice * (1 - 0.9 / pos.leverage)
        : pos.entryPrice * (1 + 0.9 / pos.leverage)
    const liqDistPct =
      pos.side === 'LONG'
        ? ((mark - liqPrice) / mark) * 100
        : ((liqPrice - mark) / mark) * 100

    unrealizedTotal += unrealizedPnl
    open.push({ pos, mark, unrealizedPnl, roePct, liqPrice, liqDistPct })
  }

  return {
    open,
    unrealizedTotal,
    sessionTotal: unrealizedTotal + state.realizedSessionPnl,
  }
}

function appendAudit(state: PaperState, summary: string, now = Date.now()): AuditEntry[] {
  return [{ ts: now, summary }, ...state.auditLog].slice(0, 12)
}

export function evaluateAlerts(state: PaperState, market: MarketState, now = Date.now()): PaperState {
  let banner = state.activeBanner
  const alerts = state.alerts.map(al => {
    if (al.acknowledged) return al
    const a = market.assets[al.symbol]
    const price = bestPrice(a)
    let hit = al.triggered
    if (!hit && price !== null) {
      if (al.condition === 'ABOVE' && price >= al.threshold) hit = true
      if (al.condition === 'BELOW' && price <= al.threshold) hit = true
      if (al.condition === 'SPREAD_BPS_ABOVE' && a.spreadBps !== null && Math.abs(a.spreadBps) >= al.threshold) {
        hit = true
      }
    }
    if (hit && !al.triggered && !banner) {
      banner = {
        id: `bn-${now}`,
        kind: 'ACK_ALERT',
        title: `ALERT: ${al.label}`,
        detail: `${al.symbol} now $${price ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--'}`,
        selectedOption: 'NO',
        createdAt: now,
        expiresAt: now + SAFETY_GATE_TTL_MS,
        alertId: al.id,
      }
    }
    return { ...al, triggered: hit }
  })
  return { ...state, alerts, activeBanner: banner }
}

export function draftReduceHalfBanner(
  state: PaperState,
  market: MarketState,
  symbol?: SymbolKey,
  now = Date.now(),
): PaperState {
  const { open } = computePositions(state, market)
  const target = (symbol ? open.find(o => o.pos.symbol === symbol) : open[0]) ?? open[0]
  if (!target) {
    return { ...state, lastActionToast: `No open ${symbol ?? ''} paper position to reduce`.trim() }
  }
  const halfQty = Number((target.pos.qty / 2).toFixed(4))
  const halfPnl = target.unrealizedPnl / 2
  const sign = halfPnl >= 0 ? '+' : '-'
  return {
    ...state,
    activeBanner: {
      id: `bn-${now}`,
      kind: 'REDUCE_50',
      title: `REDUCE 50%: ${target.pos.symbol} ${target.pos.side} ${target.pos.leverage}x`,
      detail: `Trim ${halfQty} @ $${target.mark.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${sign}$${Math.abs(halfPnl).toFixed(2)})`,
      selectedOption: 'NO',
      createdAt: now,
      expiresAt: now + SAFETY_GATE_TTL_MS,
      positionId: target.pos.id,
    },
  }
}

export function draftClosePositionBanner(
  state: PaperState,
  market: MarketState,
  symbol?: SymbolKey,
  now = Date.now(),
): PaperState {
  const { open } = computePositions(state, market)
  const target = (symbol ? open.find(o => o.pos.symbol === symbol) : open[0]) ?? open[0]
  if (!target) {
    return {
      ...state,
      activeBanner: {
        id: `bn-${now}`,
        kind: 'ACK_ALERT',
        title: 'SPREAD SIGNAL: BTC +11.4 bps',
        detail: 'Coinbase trading above Binance · Paper window',
        selectedOption: 'NO',
        createdAt: now,
        expiresAt: now + SAFETY_GATE_TTL_MS,
      },
    }
  }
  const sign = target.unrealizedPnl >= 0 ? '+' : '-'
  return {
    ...state,
    activeBanner: {
      id: `bn-${now}`,
      kind: 'CLOSE_100',
      title: `CLOSE 100%: ${target.pos.symbol} ${target.pos.side} ${target.pos.leverage}x`,
      detail: `Mark $${target.mark.toLocaleString(undefined, { maximumFractionDigits: 2 })} | PnL ${sign}$${Math.abs(target.unrealizedPnl).toFixed(2)} (${target.roePct >= 0 ? '+' : ''}${target.roePct.toFixed(1)}%)`,
      selectedOption: 'NO',
      createdAt: now,
      expiresAt: now + SAFETY_GATE_TTL_MS,
      positionId: target.pos.id,
    },
  }
}

export function draftOpenPaperBanner(
  state: PaperState,
  market: MarketState,
  symbol: SymbolKey,
  side: Side,
  qty: number,
  now = Date.now(),
): PaperState {
  const px = bestPrice(market.assets[symbol])
  return {
    ...state,
    activeBanner: {
      id: `bn-${now}`,
      kind: 'OPEN_PAPER',
      title: `OPEN PAPER: ${side} ${qty} ${symbol} 3x`,
      detail: `Est. Entry ${px ? '$' + px.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'LIVE'} · Hyperliquid (Paper)`,
      selectedOption: 'NO',
      createdAt: now,
      expiresAt: now + SAFETY_GATE_TTL_MS,
      draftOrder: { symbol, side, qty, leverage: 3 },
    },
  }
}

export function draftAddAlertBanner(
  state: PaperState,
  draft: Omit<PriceAlert, 'id' | 'triggered' | 'acknowledged'>,
  now = Date.now(),
): PaperState {
  return {
    ...state,
    activeBanner: {
      id: `bn-${now}`,
      kind: 'ADD_ALERT',
      title: `ARM ALERT: ${draft.label}`,
      detail: `Triggers G2 heads-up overlay automatically`,
      selectedOption: 'NO',
      createdAt: now,
      expiresAt: now + SAFETY_GATE_TTL_MS,
      draftAlert: draft,
    },
  }
}

export function triggerDemoTakeProfitAlert(state: PaperState, market: MarketState): PaperState {
  return draftClosePositionBanner(state, market)
}

export function toggleBannerOption(state: PaperState): PaperState {
  if (!state.activeBanner) return state
  return {
    ...state,
    activeBanner: {
      ...state.activeBanner,
      selectedOption: state.activeBanner.selectedOption === 'NO' ? 'YES' : 'NO',
    },
  }
}

export function expireBannerIfNeeded(state: PaperState, now = Date.now()): PaperState {
  if (!state.activeBanner || now < state.activeBanner.expiresAt) return state
  return {
    ...state,
    activeBanner: null,
    lastActionToast: 'Safety gate expired (Default-NO)',
    auditLog: appendAudit(state, `Expired (Default-NO): ${state.activeBanner.title}`, now),
  }
}

export function confirmBannerOnG2(state: PaperState, market: MarketState, now = Date.now()): PaperState {
  const banner = state.activeBanner
  if (!banner) return state

  if (now >= banner.expiresAt) {
    return expireBannerIfNeeded(state, now)
  }

  // Default-NO gate: tapping while NO is highlighted safely cancels without executing!
  if (banner.selectedOption === 'NO') {
    return {
      ...state,
      activeBanner: null,
      lastActionToast: 'Cancelled safely (Default-NO)',
      auditLog: appendAudit(state, `Cancelled (NO): ${banner.title}`, now),
    }
  }

  let next: PaperState = { ...state, activeBanner: null }

  if (banner.kind === 'ACK_ALERT') {
    if (banner.alertId) {
      next = {
        ...next,
        alerts: next.alerts.map(a => (a.id === banner.alertId ? { ...a, acknowledged: true } : a)),
        lastActionToast: 'Alert acknowledged on G2',
        auditLog: appendAudit(next, `Ack alert: ${banner.title}`, now),
      }
    } else {
      next = {
        ...next,
        lastActionToast: 'Alert acknowledged on G2',
        auditLog: appendAudit(next, `Ack banner: ${banner.title}`, now),
      }
    }
    return next
  }

  if (banner.kind === 'ADD_ALERT' && banner.draftAlert) {
    const created: PriceAlert = {
      id: `al-${now}`,
      ...banner.draftAlert,
      triggered: false,
      acknowledged: false,
    }
    return {
      ...next,
      alerts: [created, ...next.alerts].slice(0, 6),
      lastActionToast: `Armed: ${created.label}`,
      auditLog: appendAudit(next, `Armed alert: ${created.label}`, now),
    }
  }

  if (banner.kind === 'OPEN_PAPER' && banner.draftOrder) {
    const { symbol, side, qty, leverage } = banner.draftOrder
    const entry = bestPrice(market.assets[symbol]) ?? 100
    const created: PaperPosition = {
      id: `pos-${now}`,
      symbol,
      side,
      qty,
      entryPrice: entry,
      leverage,
      venue: 'Hyperliquid',
    }
    return {
      ...next,
      positions: [created, ...next.positions],
      lastActionToast: `Opened ${side} ${qty} ${symbol} (Paper)`,
      auditLog: appendAudit(next, `Opened ${side} ${qty} ${symbol} @ $${entry.toFixed(2)}`, now),
    }
  }

  if ((banner.kind === 'CLOSE_100' || banner.kind === 'REDUCE_50') && banner.positionId) {
    const { open } = computePositions(next, market)
    const hit = open.find(o => o.pos.id === banner.positionId)
    if (hit) {
      if (banner.kind === 'REDUCE_50') {
        const realized = hit.unrealizedPnl / 2
        const remQty = Number((hit.pos.qty / 2).toFixed(4))
        const msg = `Reduced 50% ${hit.pos.symbol} (${realized >= 0 ? '+' : '-'}$${Math.abs(realized).toFixed(2)})`
        return {
          ...next,
          realizedSessionPnl: next.realizedSessionPnl + realized,
          positions: next.positions.map(p => (p.id === hit.pos.id ? { ...p, qty: remQty } : p)),
          lastActionToast: msg,
          auditLog: appendAudit(next, msg, now),
        }
      }
      const realized = hit.unrealizedPnl
      const msg = `Closed ${hit.pos.symbol} ${hit.pos.side} (${realized >= 0 ? '+' : '-'}$${Math.abs(realized).toFixed(2)})`
      return {
        ...next,
        realizedSessionPnl: next.realizedSessionPnl + realized,
        positions: next.positions.map(p =>
          p.id === hit.pos.id ? { ...p, closedAt: now, realizedPnl: realized } : p,
        ),
        lastActionToast: msg,
        auditLog: appendAudit(next, msg, now),
      }
    }
  }

  return next
}
