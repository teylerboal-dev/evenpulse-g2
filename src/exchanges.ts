// Live public read-only market feeds (Binance Data Vision, Coinbase Exchange, Hyperliquid).
// Zero API keys required; all endpoints return CORS access-control-allow-origin: *.

export type SymbolKey = 'BTC' | 'ETH' | 'SOL' | 'BNB'

export const SYMBOLS: SymbolKey[] = ['BTC', 'ETH', 'SOL', 'BNB']

export interface AssetSnapshot {
  symbol: SymbolKey
  binancePrice: number | null
  binanceChange24h: number | null
  coinbasePrice: number | null
  hyperliquidMark: number | null
  fundingAprPct: number | null // Annualized funding rate (%)
  spreadUsd: number | null     // Coinbase - Binance
  spreadBps: number | null     // (Coinbase - Binance) / Binance * 10000
}

export interface MarketState {
  assets: Record<SymbolKey, AssetSnapshot>
  updatedAt: number
  sourcesOk: {
    binance: boolean
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
    coinbasePrice: null,
    hyperliquidMark: null,
    fundingAprPct: null,
    spreadUsd: null,
    spreadBps: null,
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
    updatedAt: 0,
    sourcesOk: { binance: false, coinbase: false, hyperliquid: false },
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
      // Annualized funding APR (%) = hourly funding * 24 * 365 * 100
      const fundingAprPct = hourlyFunding * 24 * 365 * 100
      if (Number.isFinite(mark) && mark > 0) {
        out[name] = { mark, fundingAprPct }
      }
    }
  }
  return out
}

export async function fetchAllMarkets(prev: MarketState): Promise<MarketState> {
  const [binRes, cbRes, hlRes] = await Promise.allSettled([
    fetchBinance(),
    fetchCoinbase(),
    fetchHyperliquid(),
  ])

  const bin = binRes.status === 'fulfilled' ? binRes.value : {}
  const cb = cbRes.status === 'fulfilled' ? cbRes.value : {}
  const hl = hlRes.status === 'fulfilled' ? hlRes.value : {}

  const assets: Record<SymbolKey, AssetSnapshot> = {
    BTC: { ...prev.assets.BTC },
    ETH: { ...prev.assets.ETH },
    SOL: { ...prev.assets.SOL },
    BNB: { ...prev.assets.BNB },
  }

  for (const sym of SYMBOLS) {
    const a = assets[sym]
    if (bin[sym]) {
      a.binancePrice = bin[sym]!.price
      a.binanceChange24h = bin[sym]!.change24h
    }
    if (cb[sym] !== undefined) {
      a.coinbasePrice = cb[sym]!
    }
    if (hl[sym]) {
      a.hyperliquidMark = hl[sym]!.mark
      a.fundingAprPct = hl[sym]!.fundingAprPct
    }
    if (a.binancePrice && a.coinbasePrice) {
      a.spreadUsd = a.coinbasePrice - a.binancePrice
      a.spreadBps = (a.spreadUsd / a.binancePrice) * 10000
    } else if (a.binancePrice && a.hyperliquidMark) {
      a.spreadUsd = a.hyperliquidMark - a.binancePrice
      a.spreadBps = (a.spreadUsd / a.binancePrice) * 10000
    }
  }

  const sourcesOk = {
    binance: binRes.status === 'fulfilled',
    coinbase: cbRes.status === 'fulfilled',
    hyperliquid: hlRes.status === 'fulfilled',
  }

  const anyOk = sourcesOk.binance || sourcesOk.coinbase || sourcesOk.hyperliquid
  return {
    assets,
    updatedAt: anyOk ? Date.now() : prev.updatedAt,
    sourcesOk,
    error: anyOk ? null : 'All exchange feeds unreachable — retrying...',
  }
}

export function bestPrice(a: AssetSnapshot): number | null {
  return a.binancePrice ?? a.hyperliquidMark ?? a.coinbasePrice
}
