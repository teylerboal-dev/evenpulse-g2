// Live public read-only market feeds:
// Binance Data Vision (Spot + 15m Klines + live WebSocket), OKX (Spot),
// Coinbase Exchange (USD Spot), and Hyperliquid (Perp Mark + Annualized Funding APR).
// Zero API keys required; all endpoints are public and CORS-enabled.

export type SymbolKey = 'BTC' | 'ETH' | 'SOL' | 'BNB'

export const SYMBOLS: SymbolKey[] = ['BTC', 'ETH', 'SOL', 'BNB']

export interface AssetSnapshot {
  symbol: SymbolKey
  binancePrice: number | null
  binanceChange24h: number | null
  okxPrice: number | null
  coinbasePrice: number | null
  hyperliquidMark: number | null
  fundingAprPct: number | null // Annualized funding rate (%)
  spreadUsd: number | null // Max venue dispersion or Coinbase - Binance
  spreadBps: number | null // (Ref - Binance) / Binance * 10000
  spreadVenue: 'CB' | 'OKX' | 'HL' | null
}

export interface MarketState {
  assets: Record<SymbolKey, AssetSnapshot>
  btcSparkline: number[]
  updatedAt: number
  wsConnected: boolean
  sourcesOk: {
    binance: boolean
    okx: boolean
    coinbase: boolean
    hyperliquid: boolean
  }
  error: string | null
}

function emptyAsset(symbol: SymbolKey): AssetSnapshot {
  return {
    symbol,
    binancePrice: null,
    binanceChange24h: null,
    okxPrice: null,
    coinbasePrice: null,
    hyperliquidMark: null,
    fundingAprPct: null,
    spreadUsd: null,
    spreadBps: null,
    spreadVenue: null,
  }
}

export function createInitialMarketState(): MarketState {
  return {
    assets: {
      BTC: emptyAsset('BTC'),
      ETH: emptyAsset('ETH'),
      SOL: emptyAsset('SOL'),
      BNB: emptyAsset('BNB'),
    },
    btcSparkline: [],
    updatedAt: 0,
    wsConnected: false,
    sourcesOk: { binance: false, okx: false, coinbase: false, hyperliquid: false },
    error: null,
  }
}

interface BinanceTicker {
  symbol: string
  lastPrice: string
  priceChangePercent: string
}

async function fetchBinance(): Promise<Partial<Record<SymbolKey, { price: number; change24h: number }>>> {
  const symbolsParam = encodeURIComponent(JSON.stringify(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']))
  const res = await fetch(`https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${symbolsParam}`)
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`)
  const data = (await res.json()) as BinanceTicker[]
  const out: Partial<Record<SymbolKey, { price: number; change24h: number }>> = {}
  for (const row of data) {
    const key = row.symbol.replace('USDT', '') as SymbolKey
    if (SYMBOLS.includes(key)) {
      out[key] = {
        price: Number(row.lastPrice),
        change24h: Number(row.priceChangePercent),
      }
    }
  }
  return out
}

async function fetchBinanceSparkline(): Promise<number[]> {
  const res = await fetch('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=20')
  if (!res.ok) throw new Error(`Binance klines HTTP ${res.status}`)
  const rows = (await res.json()) as Array<[number, string, string, string, string]>
  return rows.map(r => Number(r[4])).filter(v => Number.isFinite(v) && v > 0)
}

async function fetchOkx(): Promise<Partial<Record<SymbolKey, number>>> {
  const pairs: Array<[SymbolKey, string]> = [
    ['BTC', 'BTC-USDT'],
    ['ETH', 'ETH-USDT'],
    ['SOL', 'SOL-USDT'],
    ['BNB', 'BNB-USDT'],
  ]
  const results = await Promise.allSettled(
    pairs.map(async ([key, instId]) => {
      const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`)
      if (!res.ok) throw new Error(`OKX ${instId} HTTP ${res.status}`)
      const json = (await res.json()) as { data?: Array<{ last?: string }> }
      return [key, Number(json.data?.[0]?.last)] as const
    }),
  )
  const out: Partial<Record<SymbolKey, number>> = {}
  for (const r of results) {
    if (r.status === 'fulfilled' && Number.isFinite(r.value[1]) && r.value[1] > 0) {
      out[r.value[0]] = r.value[1]
    }
  }
  if (Object.keys(out).length === 0) throw new Error('OKX unavailable')
  return out
}

async function fetchCoinbase(): Promise<Partial<Record<SymbolKey, number>>> {
  const pairs: Array<[SymbolKey, string]> = [
    ['BTC', 'BTC-USD'],
    ['ETH', 'ETH-USD'],
    ['SOL', 'SOL-USD'],
  ]
  const results = await Promise.allSettled(
    pairs.map(async ([key, pair]) => {
      const res = await fetch(`https://api.exchange.coinbase.com/products/${pair}/stats`)
      if (!res.ok) throw new Error(`Coinbase ${pair} HTTP ${res.status}`)
      const json = (await res.json()) as { last?: string }
      return [key, Number(json.last)] as const
    }),
  )
  const out: Partial<Record<SymbolKey, number>> = {}
  for (const r of results) {
    if (r.status === 'fulfilled' && Number.isFinite(r.value[1]) && r.value[1] > 0) {
      out[r.value[0]] = r.value[1]
    }
  }
  if (Object.keys(out).length === 0) throw new Error('Coinbase unavailable')
  return out
}

interface HyperliquidUniverseItem {
  name: string
}
interface HyperliquidAssetCtx {
  funding: string
  markPx: string
}

async function fetchHyperliquid(): Promise<Partial<Record<SymbolKey, { mark: number; fundingAprPct: number }>>> {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  })
  if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`)
  const json = (await res.json()) as [{ universe: HyperliquidUniverseItem[] }, HyperliquidAssetCtx[]]
  const universe = json[0]?.universe ?? []
  const ctxs = json[1] ?? []
  const out: Partial<Record<SymbolKey, { mark: number; fundingAprPct: number }>> = {}
  for (let i = 0; i < universe.length && i < ctxs.length; i++) {
    const name = universe[i].name as SymbolKey
    if (SYMBOLS.includes(name)) {
      const mark = Number(ctxs[i].markPx)
      const hourlyFunding = Number(ctxs[i].funding)
      const fundingAprPct = hourlyFunding * 24 * 365 * 100
      if (Number.isFinite(mark) && mark > 0) {
        out[name] = { mark, fundingAprPct }
      }
    }
  }
  return out
}

export function recomputeAssetSpread(a: AssetSnapshot): AssetSnapshot {
  if (!a.binancePrice) return a
  if (a.coinbasePrice) {
    const spreadUsd = a.coinbasePrice - a.binancePrice
    return { ...a, spreadUsd, spreadBps: (spreadUsd / a.binancePrice) * 10000, spreadVenue: 'CB' }
  }
  if (a.okxPrice) {
    const spreadUsd = a.okxPrice - a.binancePrice
    return { ...a, spreadUsd, spreadBps: (spreadUsd / a.binancePrice) * 10000, spreadVenue: 'OKX' }
  }
  if (a.hyperliquidMark) {
    const spreadUsd = a.hyperliquidMark - a.binancePrice
    return { ...a, spreadUsd, spreadBps: (spreadUsd / a.binancePrice) * 10000, spreadVenue: 'HL' }
  }
  return a
}

export async function fetchAllMarkets(prev: MarketState): Promise<MarketState> {
  const [binRes, okxRes, cbRes, hlRes, sparkRes] = await Promise.allSettled([
    fetchBinance(),
    fetchOkx(),
    fetchCoinbase(),
    fetchHyperliquid(),
    fetchBinanceSparkline(),
  ])

  const bin = binRes.status === 'fulfilled' ? binRes.value : {}
  const okx = okxRes.status === 'fulfilled' ? okxRes.value : {}
  const cb = cbRes.status === 'fulfilled' ? cbRes.value : {}
  const hl = hlRes.status === 'fulfilled' ? hlRes.value : {}

  const assets: Record<SymbolKey, AssetSnapshot> = {
    BTC: { ...prev.assets.BTC },
    ETH: { ...prev.assets.ETH },
    SOL: { ...prev.assets.SOL },
    BNB: { ...prev.assets.BNB },
  }

  for (const sym of SYMBOLS) {
    let a = assets[sym]
    if (bin[sym]) {
      a.binancePrice = bin[sym]!.price
      a.binanceChange24h = bin[sym]!.change24h
    }
    if (okx[sym] !== undefined) {
      a.okxPrice = okx[sym]!
    }
    if (cb[sym] !== undefined) {
      a.coinbasePrice = cb[sym]!
    }
    if (hl[sym]) {
      a.hyperliquidMark = hl[sym]!.mark
      a.fundingAprPct = hl[sym]!.fundingAprPct
    }
    a = recomputeAssetSpread(a)
    assets[sym] = a
  }

  const btcSparkline =
    sparkRes.status === 'fulfilled' && sparkRes.value.length >= 2
      ? sparkRes.value
      : prev.btcSparkline

  const sourcesOk = {
    binance: binRes.status === 'fulfilled' || prev.wsConnected,
    okx: okxRes.status === 'fulfilled',
    coinbase: cbRes.status === 'fulfilled',
    hyperliquid: hlRes.status === 'fulfilled',
  }

  const anyOk = sourcesOk.binance || sourcesOk.okx || sourcesOk.coinbase || sourcesOk.hyperliquid
  return {
    assets,
    btcSparkline,
    updatedAt: anyOk ? Date.now() : prev.updatedAt,
    wsConnected: prev.wsConnected,
    sourcesOk,
    error: anyOk ? null : 'All exchange feeds unreachable — retrying...',
  }
}

export function applyLiveWsTick(
  prev: MarketState,
  symbol: SymbolKey,
  price: number,
  change24h: number,
): MarketState {
  if (!Number.isFinite(price) || price <= 0) return prev
  const updated = recomputeAssetSpread({
    ...prev.assets[symbol],
    binancePrice: price,
    binanceChange24h: Number.isFinite(change24h) ? change24h : prev.assets[symbol].binanceChange24h,
  })
  const btcSparkline =
    symbol === 'BTC' && prev.btcSparkline.length > 0
      ? [...prev.btcSparkline.slice(0, -1), price]
      : prev.btcSparkline
  return {
    ...prev,
    assets: { ...prev.assets, [symbol]: updated },
    btcSparkline,
    updatedAt: Date.now(),
    wsConnected: true,
    sourcesOk: { ...prev.sourcesOk, binance: true },
  }
}

/** Optional live Binance Vision WebSocket for sub-second price ticks (auto-falls back to REST). */
export function connectBinanceStream(
  onTick: (sym: SymbolKey, price: number, change24h: number) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  if (typeof WebSocket === 'undefined') return () => {}
  let closed = false
  let ws: WebSocket | null = null
  try {
    ws = new WebSocket(
      'wss://data-stream.binance.vision/stream?streams=btcusdt@miniTicker/ethusdt@miniTicker/solusdt@miniTicker/bnbusdt@miniTicker',
    )
    ws.onopen = () => {
      if (!closed) onStatus(true)
    }
    ws.onmessage = ev => {
      if (closed) return
      try {
        const msg = JSON.parse(String(ev.data)) as { data?: { s?: string; c?: string; o?: string } }
        const d = msg.data
        if (!d?.s || !d.c) return
        const sym = d.s.replace('USDT', '') as SymbolKey
        if (!SYMBOLS.includes(sym)) return
        const price = Number(d.c)
        const open = Number(d.o)
        const chg = Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : NaN
        onTick(sym, price, chg)
      } catch {
        // ignore malformed frame
      }
    }
    ws.onclose = () => {
      if (!closed) onStatus(false)
    }
    ws.onerror = () => {
      if (!closed) onStatus(false)
    }
  } catch {
    onStatus(false)
  }
  return () => {
    closed = true
    try {
      ws?.close()
    } catch {
      // ignore
    }
  }
}

export function bestPrice(a: AssetSnapshot): number | null {
  return a.binancePrice ?? a.okxPrice ?? a.hyperliquidMark ?? a.coinbasePrice
}
