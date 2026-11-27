// 200x96 4-bit monochrome-green micro-LED graphic renderer for Even Realities G2.
// Draws onto an offscreen/preview HTMLCanvasElement and encodes compact PNG bytes
// for bridge.updateImageRawData() (within SDK limits: width 20..288, height 20..144).

import { bestPrice, type MarketState, SYMBOLS } from './exchanges'
import { computePositions, type PaperState } from './paper'
import type { HudView } from './g2-renderer'

export const G2_IMG_WIDTH = 200
export const G2_IMG_HEIGHT = 96

const GREEN_BG = '#040c06'
const GREEN_GRID = '#0d2e17'
const GREEN_DIM = '#176633'
const GREEN_MID = '#22b859'
const GREEN_HI = '#39ff85'

export interface GraphicRenderInput {
  view: HudView
  market: MarketState
  paper: PaperState
  voiceListening: boolean
  voiceHistory: number[]
  nowMs: number
}

export function drawG2GraphicToCanvas(
  ctx: CanvasRenderingContext2D,
  input: GraphicRenderInput,
): void {
  const { view, market, paper, voiceListening, voiceHistory, nowMs } = input
  const w = G2_IMG_WIDTH
  const h = G2_IMG_HEIGHT

  // Background + subtle micro-LED frame
  ctx.fillStyle = GREEN_BG
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = GREEN_DIM
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

  // Horizontal subtle grid lines
  ctx.strokeStyle = GREEN_GRID
  for (let y = 24; y < h; y += 24) {
    ctx.beginPath()
    ctx.moveTo(2, y + 0.5)
    ctx.lineTo(w - 2, y + 0.5)
    ctx.stroke()
  }

  ctx.font = 'bold 10px ui-monospace, Menlo, Consolas, monospace'
  ctx.textBaseline = 'top'

  // 1) Active Safety Gate countdown bar takes priority
  if (paper.activeBanner) {
    const b = paper.activeBanner
    const totalMs = Math.max(1000, b.expiresAt - b.createdAt)
    const remainMs = Math.max(0, b.expiresAt - nowMs)
    const ratio = remainMs / totalMs
    const secs = Math.ceil(remainMs / 1000)

    ctx.fillStyle = GREEN_HI
    ctx.fillText('SAFETY GATE · DEFAULT-NO', 8, 8)
    ctx.fillStyle = GREEN_MID
    ctx.fillText(`AUTO-CANCEL IN ${secs}s`, 8, 24)

    // Countdown gauge
    ctx.strokeStyle = GREEN_MID
    ctx.strokeRect(8.5, 42.5, w - 17, 14)
    ctx.fillStyle = b.selectedOption === 'YES' ? GREEN_HI : GREEN_DIM
    ctx.fillRect(10, 44, Math.round((w - 20) * ratio), 11)

    // Toggle indicator pills [NO] / [YES]
    const noActive = b.selectedOption === 'NO'
    ctx.fillStyle = noActive ? GREEN_HI : GREEN_GRID
    ctx.fillRect(8, 66, 86, 20)
    ctx.fillStyle = noActive ? GREEN_BG : GREEN_DIM
    ctx.fillText(noActive ? '> [NO] SAFE' : '  [NO] SAFE', 14, 71)

    ctx.fillStyle = !noActive ? GREEN_HI : GREEN_GRID
    ctx.fillRect(104, 66, 88, 20)
    ctx.fillStyle = !noActive ? GREEN_BG : GREEN_DIM
    ctx.fillText(!noActive ? '> [YES] RUN' : '  [YES] RUN', 110, 71)
    return
  }

  // 2) Voice Push-to-Talk 16kHz PCM Waveform
  if (voiceListening) {
    ctx.fillStyle = GREEN_HI
    ctx.fillText('MIC LIVE · 16kHz PCM', 8, 8)
    const bars = 24
    const barW = 5
    const gap = 2
    const startX = 14
    for (let i = 0; i < bars; i++) {
      const energy = voiceHistory[voiceHistory.length - bars + i] ?? 0.12
      const bh = Math.max(4, Math.round(energy * 56))
      const x = startX + i * (barW + gap)
      const y = 84 - bh
      ctx.fillStyle = energy > 0.55 ? GREEN_HI : GREEN_MID
      ctx.fillRect(x, y, barW, bh)
    }
    return
  }

  // 3) MARKETS view -> Live 15m BTC sparkline
  if (view === 'MARKETS') {
    const series = market.btcSparkline.length >= 2 ? market.btcSparkline : [90000, 90050, 90120, 90080, 90210]
    const min = Math.min(...series)
    const max = Math.max(...series)
    const span = Math.max(0.01, max - min)
    const delta = ((series[series.length - 1] - series[0]) / series[0]) * 100

    ctx.fillStyle = GREEN_HI
    ctx.fillText(`BTC 15m  ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`, 8, 7)
    ctx.fillStyle = GREEN_DIM
    ctx.fillText(`${market.wsConnected ? 'WS' : 'REST'}`, w - 34, 7)

    const padX = 8
    const topY = 24
    const plotH = 54
    const plotW = w - padX * 2

    // Fill area under sparkline in 4-bit dim shade
    ctx.beginPath()
    series.forEach((v, idx) => {
      const x = padX + (idx / (series.length - 1)) * plotW
      const y = topY + plotH - ((v - min) / span) * plotH
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.lineTo(padX + plotW, topY + plotH)
    ctx.lineTo(padX, topY + plotH)
    ctx.closePath()
    ctx.fillStyle = 'rgba(34, 184, 89, 0.22)'
    ctx.fill()

    // Crisp bright sparkline stroke
    ctx.beginPath()
    series.forEach((v, idx) => {
      const x = padX + (idx / (series.length - 1)) * plotW
      const y = topY + plotH - ((v - min) / span) * plotH
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = GREEN_HI
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.fillStyle = GREEN_MID
    ctx.fillText(`L:${Math.round(min)}`, 8, 82)
    ctx.fillText(`H:${Math.round(max)}`, 112, 82)
    return
  }

  // 4) POSITIONS view -> Liquidation safety gauges
  if (view === 'POSITIONS') {
    const { open, sessionTotal } = computePositions(paper, market)
    ctx.fillStyle = GREEN_HI
    ctx.fillText(`LIQ SAFETY · ${sessionTotal >= 0 ? '+' : '-'}$${Math.abs(sessionTotal).toFixed(0)}`, 8, 7)
    if (open.length === 0) {
      ctx.fillStyle = GREEN_MID
      ctx.fillText('ALL POSITIONS FLAT', 8, 42)
      return
    }
    open.slice(0, 3).forEach((item, idx) => {
      const y = 26 + idx * 22
      ctx.fillStyle = GREEN_MID
      ctx.fillText(`${item.pos.symbol}`, 8, y)
      const barX = 40
      const barW = 104
      ctx.strokeStyle = GREEN_DIM
      ctx.strokeRect(barX + 0.5, y + 0.5, barW, 11)
      const safetyRatio = Math.max(0.05, Math.min(1, item.liqDistPct / 30))
      ctx.fillStyle = item.liqDistPct < 10 ? GREEN_HI : GREEN_MID
      ctx.fillRect(barX + 2, y + 2, Math.round((barW - 4) * safetyRatio), 8)
      ctx.fillStyle = GREEN_HI
      ctx.fillText(`${item.liqDistPct.toFixed(0)}%`, 152, y)
    })
    return
  }

  // 5) SPREADS view -> 4-Venue Spread Bar Chart (bps)
  if (view === 'SPREADS') {
    ctx.fillStyle = GREEN_HI
    ctx.fillText('4-VENUE SPREAD (BPS)', 8, 7)
    const center = 116
    ctx.strokeStyle = GREEN_DIM
    ctx.beginPath()
    ctx.moveTo(center + 0.5, 22)
    ctx.lineTo(center + 0.5, 88)
    ctx.stroke()

    SYMBOLS.forEach((sym, idx) => {
      const a = market.assets[sym]
      const bps = a.spreadBps ?? 0
      const y = 24 + idx * 16
      ctx.fillStyle = GREEN_MID
      ctx.fillText(sym, 8, y)
      const clamped = Math.max(-25, Math.min(25, bps))
      const px = Math.round((Math.abs(clamped) / 25) * 62)
      ctx.fillStyle = Math.abs(bps) >= 8 ? GREEN_HI : GREEN_MID
      if (clamped >= 0) {
        ctx.fillRect(center + 1, y + 1, Math.max(2, px), 9)
      } else {
        ctx.fillRect(center - Math.max(2, px), y + 1, Math.max(2, px), 9)
      }
      ctx.fillStyle = GREEN_HI
      ctx.fillText(`${bps >= 0 ? '+' : ''}${bps.toFixed(1)}`, 40, y)
    })
    return
  }

  // 6) ALERTS view -> Active Alert Radar + Audit Summary
  const armed = paper.alerts.filter(a => !a.acknowledged && !a.triggered).length
  const hit = paper.alerts.filter(a => !a.acknowledged && a.triggered).length
  const btcPx = bestPrice(market.assets.BTC)
  ctx.fillStyle = GREEN_HI
  ctx.fillText('ALERT ENGINE · ARMED', 8, 7)
  ctx.fillStyle = GREEN_MID
  ctx.fillText(`ARMED: ${armed}   HIT: ${hit}`, 8, 28)
  ctx.fillText(`AUDIT LOG: ${paper.auditLog.length} ACTIONS`, 8, 46)
  ctx.fillStyle = GREEN_DIM
  ctx.fillText(`BTC REF: ${btcPx ? '$' + Math.round(btcPx).toLocaleString() : '--'}`, 8, 66)
  ctx.fillStyle = GREEN_HI
  ctx.fillText('TAP: NEXT · VOICE: CMD', 8, 80)
}

/** Encode a canvas into PNG bytes (Uint8Array) suitable for Even Hub updateImageRawData(). */
export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  if (typeof canvas.toBlob !== 'function') return null
  return new Promise(resolve => {
    canvas.toBlob(async blob => {
      if (!blob) {
        resolve(null)
        return
      }
      const buf = await blob.arrayBuffer()
      resolve(new Uint8Array(buf))
    }, 'image/png')
  })
}
