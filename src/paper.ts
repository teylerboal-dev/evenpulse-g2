// Paper-trading positions, live session PnL, liquidation distance, and 1-tap G2 alerts.
// Strictly read-only / paper-trading only — holds zero user funds or exchange API keys.

import { bestPrice, MarketState, SymbolKey } from './exchanges'

export type Side = 'LONG' | 'SHORT'

export interface PaperPosition {
  id: string
  symbol: SymbolKey
  side: Side
  qty: number
  entryPrice: number
  leverage: number
  venue: 'Binance' | 'Coinbase' | 'Hyperliquid'
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

export interface PaperState {
  positions: PaperPosition[]
  realizedSessionPnl: number
  alerts: PriceAlert[]
  activeBanner: {
    title: string
    detail: string
    actionLabel: string
    positionId?: string
    alertId?: string
  } | null
  seededFromLive: boolean
  lastActionToast: string | null
}

export function createInitialPaperState(): PaperState {
  return {
    positions: [],
    realizedSessionPnl: 0,
    alerts: [],
    activeBanner: null,
    seededFromLive: false,
    lastActionToast: null,
  }
}

/**
 * Seeds realistic paper positions anchored slightly off the live market prices
 * on the first live tick so judges immediately see moving PnL & liquidation distances.
 */
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
      venue: 'Coinbase',
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
      label: 'BTC CB-Bin Spread > 8 bps',
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
    if (pos.closedAt) continue
    const mark = bestPrice(market.assets[pos.symbol]) ?? pos.entryPrice
    const dir = pos.side === 'LONG' ? 1 : -1
    const unrealizedPnl = (mark - pos.entryPrice) * pos.qty * dir
    const margin = (pos.entryPrice * pos.qty) / pos.leverage
    const roePct = margin > 0 ? (unrealizedPnl / margin) * 100 : 0
    // Approximate isolated liq price (90% margin loss)
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

export function evaluateAlerts(state: PaperState, market: MarketState): PaperState {
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
        title: `ALERT: ${al.label}`,
        detail: `${al.symbol} now $${price ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--'}`,
        actionLabel: 'Tap G2 to Acknowledge',
        alertId: al.id,
      }
    }
    return { ...al, triggered: hit }
  })
  return { ...state, alerts, activeBanner: banner }
}

export function triggerDemoTakeProfitAlert(state: PaperState, market: MarketState): PaperState {
  const { open } = computePositions(state, market)
  const target = open[0]
  if (!target) {
    return {
      ...state,
      activeBanner: {
        title: 'DEMO ALERT: BTC SPREAD +11.4 bps',
        detail: 'Coinbase trading above Binance · Arb window open',
        actionLabel: 'Tap G2 to Acknowledge',
      },
    }
  }
  const sign = target.unrealizedPnl >= 0 ? '+' : ''
  return {
    ...state,
    activeBanner: {
      title: `TP ALERT: ${target.pos.symbol} ${target.pos.side} ${target.pos.leverage}x`,
      detail: `Mark $${target.mark.toLocaleString(undefined, { maximumFractionDigits: 2 })} | PnL ${sign}$${target.unrealizedPnl.toFixed(2)} (${sign}${target.roePct.toFixed(1)}%)`,
      actionLabel: 'Tap G2: 1-Tap Paper Close',
      positionId: target.pos.id,
    },
  }
}

export function confirmBannerOnG2(state: PaperState, market: MarketState): PaperState {
  if (!state.activeBanner) return state
  const { positionId, alertId } = state.activeBanner

  let next = { ...state, activeBanner: null as PaperState['activeBanner'] }

  if (alertId) {
    next = {
      ...next,
      alerts: next.alerts.map(a => (a.id === alertId ? { ...a, acknowledged: true } : a)),
      lastActionToast: 'Alert acknowledged on G2',
    }
  }

  if (positionId) {
    const { open } = computePositions(next, market)
    const hit = open.find(o => o.pos.id === positionId)
    if (hit) {
      const realized = hit.unrealizedPnl
      next = {
        ...next,
        realizedSessionPnl: next.realizedSessionPnl + realized,
        positions: next.positions.map(p =>
          p.id === positionId ? { ...p, closedAt: Date.now(), realizedPnl: realized } : p,
        ),
        lastActionToast: `Closed ${hit.pos.symbol} ${hit.pos.side} (${realized >= 0 ? '+' : ''}$${realized.toFixed(2)})`,
      }
    }
  } else if (!alertId) {
    next = { ...next, lastActionToast: 'Alert acknowledged on G2' }
  }

  return next
}
