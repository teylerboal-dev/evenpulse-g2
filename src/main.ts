import {
  waitForEvenAppBridge,
  TextContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import {
  applyLiveWsTick,
  connectBinanceStream,
  createInitialMarketState,
  fetchAllMarkets,
  type MarketState,
  type SymbolKey,
} from './exchanges'
import {
  computePositions,
  confirmBannerOnG2,
  createInitialPaperState,
  draftAddAlertBanner,
  draftClosePositionBanner,
  draftOpenPaperBanner,
  draftReduceHalfBanner,
  evaluateAlerts,
  expireBannerIfNeeded,
  seedPaperFromLive,
  toggleBannerOption,
  type PaperState,
} from './paper'
import { HUD_VIEWS, renderHudFrame, type HudView } from './g2-renderer'
import { canvasToPngBytes, drawG2GraphicToCanvas, G2_IMG_HEIGHT, G2_IMG_WIDTH } from './g2-graphics'
import { computePcmEnergy, parseVoiceCommand, VOICE_PRESETS } from './voice'

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

let market: MarketState = createInitialMarketState()
let paper: PaperState = createInitialPaperState()
let viewIndex = 0
let arOpticalMode = false
let voiceListening = false
let lastTranscript: string | null = null
let voiceHistory: number[] = Array(24).fill(0.1)
let bridge: EvenAppBridge | null = null
let bridgeConnected = false
let rendering: Promise<unknown> = Promise.resolve()
let lastImageSentAt = 0
let pollTimer: number | null = null
let tickTimer: number | null = null
let voiceAnimTimer: number | null = null
let unsubscribeBridge: (() => void) | null = null
let disconnectWs: (() => void) | null = null
let offscreenCanvas: HTMLCanvasElement | null = null

function currentView(): HudView {
  return HUD_VIEWS[viewIndex]
}

async function connectBridgeWithTimeout(ms = 1600): Promise<EvenAppBridge | null> {
  try {
    return await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), ms)),
    ])
  } catch {
    return null
  }
}

async function initG2Page(b: EvenAppBridge) {
  const { body, status, footer } = renderHudFrame(currentView(), market, paper, {
    voiceListening,
    lastTranscript,
  })

  const bodyContainer = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 142,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 1,
    containerName: 'hud',
    content: body,
    isEventCapture: 1,
  })

  const statusContainer = new TextContainerProperty({
    xPosition: 0,
    yPosition: 146,
    width: 366,
    height: 96,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 4,
    containerName: 'status',
    content: status,
    isEventCapture: 0,
  })

  const chartContainer = new ImageContainerProperty({
    xPosition: 372,
    yPosition: 146,
    width: G2_IMG_WIDTH,
    height: G2_IMG_HEIGHT,
    containerID: 3,
    containerName: 'chart',
  })

  const footerContainer = new TextContainerProperty({
    xPosition: 0,
    yPosition: 248,
    width: 576,
    height: 36,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 2,
    containerName: 'footer',
    content: footer,
    isEventCapture: 0,
  })

  const res = await b.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 4,
      textObject: [bodyContainer, statusContainer, footerContainer],
      imageObject: [chartContainer],
    }),
  )
  if (res !== 0) {
    console.error('EvenPulse createStartUpPageContainer failed:', res)
  }
}

function getOffscreenCanvas(): HTMLCanvasElement {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas')
    offscreenCanvas.width = G2_IMG_WIDTH
    offscreenCanvas.height = G2_IMG_HEIGHT
  }
  return offscreenCanvas
}

function paintGraphicCanvas(canvas: HTMLCanvasElement, nowMs: number) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  drawG2GraphicToCanvas(ctx, {
    view: currentView(),
    market,
    paper,
    voiceListening,
    voiceHistory,
    nowMs,
  })
}

function pushHudUpdate(forceImage = false) {
  const nowMs = Date.now()
  paper = expireBannerIfNeeded(paper, nowMs)
  const { body, status, footer } = renderHudFrame(currentView(), market, paper, {
    voiceListening,
    lastTranscript,
    nowMs,
  })
  renderCompanionUi(body, status, footer, nowMs)

  if (!bridge) return
  const b = bridge
  const shouldSendImage = forceImage || nowMs - lastImageSentAt >= 1200
  let pngPromise: Promise<Uint8Array | null> = Promise.resolve(null)
  if (shouldSendImage) {
    lastImageSentAt = nowMs
    const c = getOffscreenCanvas()
    paintGraphicCanvas(c, nowMs)
    pngPromise = canvasToPngBytes(c)
  }

  rendering = rendering
    .then(async () => {
      await b.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 1, containerName: 'hud', content: body }),
      )
      await b.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 4, containerName: 'status', content: status }),
      )
      await b.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 2, containerName: 'footer', content: footer }),
      )
      const pngBytes = await pngPromise
      if (pngBytes && pngBytes.byteLength > 0) {
        await b.updateImageRawData(
          new ImageRawDataUpdate({
            containerID: 3,
            containerName: 'chart',
            imageData: pngBytes,
          }),
        )
      }
    })
    .catch(err => console.error('G2 upgrade failed:', err))
}

function handleTap() {
  if (paper.activeBanner) {
    paper = confirmBannerOnG2(paper, market)
    pushHudUpdate(true)
    return
  }
  if (currentView() === 'MARKETS') {
    void refreshMarkets()
    return
  }
  viewIndex = (viewIndex + 1) % HUD_VIEWS.length
  pushHudUpdate(true)
}

function handleSwipe(delta: -1 | 1) {
  if (paper.activeBanner) {
    // Inside Default-NO Safety Gate, swipe toggles [NO] <-> [YES]
    paper = toggleBannerOption(paper)
    pushHudUpdate(true)
    return
  }
  viewIndex = (viewIndex + delta + HUD_VIEWS.length) % HUD_VIEWS.length
  pushHudUpdate(true)
}

function handleDoubleTap() {
  if (bridge) {
    bridge.shutDownPageContainer(1)
  } else {
    paper = { ...paper, activeBanner: null, lastActionToast: 'Double-tap: Exit sent to G2' }
    pushHudUpdate(true)
  }
}

function executeVoiceTranscript(raw: string) {
  const intent = parseVoiceCommand(raw)
  lastTranscript = intent.transcript
  if (intent.kind === 'NAVIGATE') {
    viewIndex = HUD_VIEWS.indexOf(intent.view)
    paper = { ...paper, lastActionToast: `Voice -> ${intent.view}` }
  } else if (intent.kind === 'REDUCE_HALF') {
    paper = draftReduceHalfBanner(paper, market, intent.symbol)
  } else if (intent.kind === 'CLOSE_POSITION') {
    paper = draftClosePositionBanner(paper, market, intent.symbol)
  } else if (intent.kind === 'OPEN_PAPER') {
    paper = draftOpenPaperBanner(paper, market, intent.symbol, intent.side, intent.qty)
  } else if (intent.kind === 'ADD_PRICE_ALERT') {
    const sym = intent.symbol
    const op = intent.condition === 'ABOVE' ? '>' : '<'
    paper = draftAddAlertBanner(paper, {
      symbol: sym,
      condition: intent.condition,
      threshold: intent.threshold,
      label: `${sym} ${op} $${intent.threshold.toLocaleString()}`,
    })
  } else if (intent.kind === 'ADD_SPREAD_ALERT') {
    paper = draftAddAlertBanner(paper, {
      symbol: 'BTC',
      condition: 'SPREAD_BPS_ABOVE',
      threshold: intent.thresholdBps,
      label: `BTC Spread > ${intent.thresholdBps} bps`,
    })
  } else {
    paper = { ...paper, lastActionToast: `Voice: try "Reduce BTC 50%"` }
  }
  pushHudUpdate(true)
}

async function toggleVoiceMic() {
  if (voiceListening) {
    voiceListening = false
    if (voiceAnimTimer !== null) {
      window.clearInterval(voiceAnimTimer)
      voiceAnimTimer = null
    }
    if (bridge) {
      try {
        await bridge.audioControl(false)
      } catch {
        // ignore
      }
    }
    pushHudUpdate(true)
    return
  }

  voiceListening = true
  if (bridge) {
    try {
      await bridge.audioControl(true)
    } catch {
      // ignore if simulator lacks mic permission
    }
  }

  // Try browser Web Speech API when available in standalone preview
  const SpeechRec =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition

  if (SpeechRec && !bridge) {
    try {
      const rec = new SpeechRec()
      rec.lang = 'en-US'
      rec.interimResults = false
      rec.maxAlternatives = 1
      rec.onresult = ev => {
        const spoken = ev.results?.[0]?.[0]?.transcript ?? ''
        voiceListening = false
        if (voiceAnimTimer !== null) {
          window.clearInterval(voiceAnimTimer)
          voiceAnimTimer = null
        }
        if (spoken) executeVoiceTranscript(spoken)
      }
      rec.onerror = () => {
        voiceListening = false
        if (voiceAnimTimer !== null) {
          window.clearInterval(voiceAnimTimer)
          voiceAnimTimer = null
        }
        pushHudUpdate(true)
      }
      rec.onend = () => {
        if (voiceListening) {
          voiceListening = false
          if (voiceAnimTimer !== null) {
            window.clearInterval(voiceAnimTimer)
            voiceAnimTimer = null
          }
          pushHudUpdate(true)
        }
      }
      rec.start()
    } catch {
      // fallback to simulated waveform + preset buttons
    }
  }

  voiceAnimTimer = window.setInterval(() => {
    const sample = 0.18 + Math.random() * 0.72
    voiceHistory = [...voiceHistory.slice(1), sample]
    pushHudUpdate(false)
  }, 250)

  pushHudUpdate(true)
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((ev: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
}

async function refreshMarkets() {
  market = await fetchAllMarkets(market)
  paper = seedPaperFromLive(paper, market)
  paper = evaluateAlerts(paper, market)
  pushHudUpdate(true)
}

function renderCompanionUi(body: string, status: string, footer: string, nowMs: number) {
  const root = document.querySelector<HTMLDivElement>('#app')
  if (!root) return

  const { open, sessionTotal } = computePositions(paper, market)
  const pnlClass = sessionTotal >= 0 ? 'pos' : 'neg'
  const pnlText = `${sessionTotal >= 0 ? '+' : '-'}$${Math.abs(sessionTotal).toFixed(2)}`
  const btcSpread =
    market.assets.BTC.spreadBps !== null
      ? `${market.assets.BTC.spreadBps >= 0 ? '+' : ''}${market.assets.BTC.spreadBps.toFixed(1)} bps`
      : '--'

  const auditHtml =
    paper.auditLog.length === 0
      ? '<div class="muted">No safety-gated actions executed yet. Try Voice PTT or Reduce 50%.</div>'
      : paper.auditLog
          .slice(0, 4)
          .map(
            e =>
              `<div class="audit-row"><span>${new Date(e.ts).toLocaleTimeString('en-US', { hour12: false })}</span><span>${escapeHtml(e.summary)}</span></div>`,
          )
          .join('')

  root.innerHTML = `
    <div class="wrap">
      <header>
        <div>
          <h1>EvenPulse v2.0 — Multi-Exchange &amp; Voice G2 HUD</h1>
          <div class="subtitle">Tracks 02 &amp; 03 · 4-Venue Live Feeds · 4-Bit Micro-LED Graphics · Default-NO Voice Safety Gates</div>
        </div>
        <div class="pills">
          <span class="pill ${bridgeConnected ? 'ok' : ''}">${bridgeConnected ? 'G2 Bridge' : 'G2 Mirror'}</span>
          <span class="pill ${market.wsConnected ? 'ok' : ''}">${market.wsConnected ? 'WS Live' : 'REST'}</span>
          <span class="pill ${market.sourcesOk.binance ? 'ok' : 'err'}">Binance</span>
          <span class="pill ${market.sourcesOk.okx ? 'ok' : 'err'}">OKX</span>
          <span class="pill ${market.sourcesOk.coinbase ? 'ok' : 'err'}">Coinbase</span>
          <span class="pill ${market.sourcesOk.hyperliquid ? 'ok' : 'err'}">Hyperliquid</span>
        </div>
      </header>

      <section class="g2-frame ${arOpticalMode ? 'ar-optical' : ''}" aria-label="Even G2 576x288 Monochrome Green HUD Mirror">
        <div class="g2-meta">
          <span>EVEN G2 · 576×288 · 4 CONTAINERS (TEXT + 4-BIT IMAGE)</span>
          <span>VIEW: ${currentView()} (${viewIndex + 1}/${HUD_VIEWS.length}) · KEYS: ↑↓ / ENTER</span>
        </div>
        <div class="g2-screen">
          <pre class="g2-body">${escapeHtml(body)}</pre>
          <div class="g2-mid">
            <pre class="g2-status">${escapeHtml(status)}</pre>
            <canvas id="g2-chart" width="${G2_IMG_WIDTH}" height="${G2_IMG_HEIGHT}" class="g2-canvas"></canvas>
          </div>
          <div class="g2-footer">${escapeHtml(footer)}</div>
        </div>
      </section>

      <div class="controls">
        <button id="btn-prev">↑ Swipe Up${paper.activeBanner ? ' (NO/YES)' : ''}</button>
        <button id="btn-next">↓ Swipe Down${paper.activeBanner ? ' (NO/YES)' : ''}</button>
        <button id="btn-tap" class="${paper.activeBanner ? 'primary' : ''}">● Tap G2${paper.activeBanner ? ` (${paper.activeBanner.selectedOption})` : ''}</button>
        <button id="btn-voice" class="${voiceListening ? 'danger-btn' : ''}">${voiceListening ? '■ Stop Mic' : '🎙 Voice PTT'}</button>
        <button id="btn-ar">${arOpticalMode ? '👓 Lab Lens' : '👓 AR Overlay'}</button>
      </div>

      <section class="card">
        <h2>Write Actions (Default-NO 30s Safety Gate · Zero Real Orders)</h2>
        <div class="controls-tight">
          <button id="btn-reduce" class="primary">✂ Reduce BTC 50%</button>
          <button id="btn-close">⚡ Close 100% TP</button>
          <button id="btn-open">＋ Paper Long SOL</button>
          <button id="btn-reset">↺ Reset Paper</button>
        </div>
        <div class="voice-row">
          <input id="voice-input" type="text" placeholder='Type or speak: "Reduce BTC 50%", "Alert BTC above 95000", "Show spreads"' />
          <button id="btn-run-voice">Run Voice Intent</button>
        </div>
        <div class="preset-chips">
          ${VOICE_PRESETS.map((p, idx) => `<button class="chip" data-preset="${idx}">"${escapeHtml(p)}"</button>`).join('')}
        </div>
      </section>

      <section class="card">
        <h2>Live Multi-Venue Telemetry (Read-Only Public APIs)</h2>
        <div class="grid-2">
          <div class="stat">
            <div class="label">Total Session PnL (Paper)</div>
            <div class="val ${pnlClass}">${pnlText}</div>
          </div>
          <div class="stat">
            <div class="label">Open Positions</div>
            <div class="val">${open.length} Active</div>
          </div>
          <div class="stat">
            <div class="label">BTC Cross-Venue Spread</div>
            <div class="val">${btcSpread}</div>
          </div>
          <div class="stat">
            <div class="label">BTC Hyperliquid Funding (APR)</div>
            <div class="val">${
              market.assets.BTC.fundingAprPct !== null
                ? `${market.assets.BTC.fundingAprPct >= 0 ? '+' : ''}${market.assets.BTC.fundingAprPct.toFixed(1)}%`
                : '--'
            }</div>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Safety Gate Audit Log</h2>
        ${auditHtml}
      </section>

      <footer class="note">
        EvenPulse v2.0 · Official Even Hub SDK (Text + ImageRawData + AudioControl) · Binance, OKX, Coinbase &amp; Hyperliquid public read-only feeds · Zero API keys, zero custody.
      </footer>
    </div>
  `

  const canvas = document.getElementById('g2-chart') as HTMLCanvasElement | null
  if (canvas) {
    paintGraphicCanvas(canvas, nowMs)
  }

  document.getElementById('btn-prev')?.addEventListener('click', () => handleSwipe(-1))
  document.getElementById('btn-next')?.addEventListener('click', () => handleSwipe(1))
  document.getElementById('btn-tap')?.addEventListener('click', () => handleTap())
  document.getElementById('btn-voice')?.addEventListener('click', () => void toggleVoiceMic())
  document.getElementById('btn-ar')?.addEventListener('click', () => {
    arOpticalMode = !arOpticalMode
    pushHudUpdate(false)
  })
  document.getElementById('btn-reduce')?.addEventListener('click', () => {
    paper = draftReduceHalfBanner(paper, market, 'BTC')
    pushHudUpdate(true)
  })
  document.getElementById('btn-close')?.addEventListener('click', () => {
    paper = draftClosePositionBanner(paper, market)
    pushHudUpdate(true)
  })
  document.getElementById('btn-open')?.addEventListener('click', () => {
    paper = draftOpenPaperBanner(paper, market, 'SOL', 'LONG', 10)
    pushHudUpdate(true)
  })
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    paper = seedPaperFromLive(createInitialPaperState(), market)
    paper.lastActionToast = 'Paper positions reset to live prices'
    pushHudUpdate(true)
  })

  const runTypedVoice = () => {
    const inp = document.getElementById('voice-input') as HTMLInputElement | null
    if (inp && inp.value.trim()) {
      executeVoiceTranscript(inp.value.trim())
    }
  }
  document.getElementById('btn-run-voice')?.addEventListener('click', runTypedVoice)
  document.getElementById('voice-input')?.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') runTypedVoice()
  })
  document.querySelectorAll<HTMLButtonElement>('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.preset)
      const text = VOICE_PRESETS[idx]
      if (text) executeVoiceTranscript(text)
    })
  })
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function onKeyDown(ev: KeyboardEvent) {
  const active = document.activeElement
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
  if (ev.key === 'ArrowUp') {
    ev.preventDefault()
    handleSwipe(-1)
  } else if (ev.key === 'ArrowDown') {
    ev.preventDefault()
    handleSwipe(1)
  } else if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault()
    handleTap()
  } else if (ev.key === 'Escape') {
    ev.preventDefault()
    handleDoubleTap()
  }
}

function cleanup() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
  if (voiceAnimTimer !== null) {
    window.clearInterval(voiceAnimTimer)
    voiceAnimTimer = null
  }
  if (disconnectWs) {
    disconnectWs()
    disconnectWs = null
  }
  if (unsubscribeBridge) {
    unsubscribeBridge()
    unsubscribeBridge = null
  }
  window.removeEventListener('keydown', onKeyDown)
}

async function boot() {
  pushHudUpdate(true)
  window.addEventListener('keydown', onKeyDown)

  bridge = await connectBridgeWithTimeout(1600)
  if (bridge) {
    bridgeConnected = true
    await initG2Page(bridge)
    unsubscribeBridge = bridge.onEvenHubEvent(event => {
      if (event.audioEvent?.audioPcm) {
        const energy = computePcmEnergy(event.audioEvent.audioPcm)
        voiceHistory = [...voiceHistory.slice(1), energy]
        pushHudUpdate(false)
        return
      }
      const sysType = eventTypeOf(event.sysEvent)
      const textType = eventTypeOf(event.textEvent)

      if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        handleDoubleTap()
        return
      }
      if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
        handleSwipe(-1)
        return
      }
      if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        handleSwipe(1)
        return
      }
      if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
        handleTap()
        return
      }
      if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
        cleanup()
      }
    })
  }

  window.addEventListener('beforeunload', cleanup)

  await refreshMarkets()

  // Live sub-second Binance WebSocket ticks with REST polling for OKX/Coinbase/Hyperliquid
  let lastWsUiAt = 0
  disconnectWs = connectBinanceStream(
    (sym: SymbolKey, price: number, chg: number) => {
      market = applyLiveWsTick(market, sym, price, chg)
      paper = seedPaperFromLive(paper, market)
      paper = evaluateAlerts(paper, market)
      const now = Date.now()
      if (now - lastWsUiAt >= 1000) {
        lastWsUiAt = now
        pushHudUpdate(false)
      }
    },
    connected => {
      market = { ...market, wsConnected: connected }
      pushHudUpdate(false)
    },
  )

  pollTimer = window.setInterval(() => {
    void refreshMarkets()
  }, 10_000)

  // Countdown tick for active Default-NO Safety Gate
  tickTimer = window.setInterval(() => {
    if (paper.activeBanner) {
      pushHudUpdate(false)
    }
  }, 1000)
}

void boot()
