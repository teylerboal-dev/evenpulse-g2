import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { createInitialMarketState, fetchAllMarkets, type MarketState } from './exchanges'
import {
  computePositions,
  confirmBannerOnG2,
  createInitialPaperState,
  evaluateAlerts,
  seedPaperFromLive,
  triggerDemoTakeProfitAlert,
  type PaperState,
} from './paper'
import { HUD_VIEWS, renderHudFrame, type HudView } from './g2-renderer'

// Exact Even Hub SDK protobuf-zero-safe event helper (from evenhub-templates/minimal)
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

let market: MarketState = createInitialMarketState()
let paper: PaperState = createInitialPaperState()
let viewIndex = 0
let bridge: EvenAppBridge | null = null
let bridgeConnected = false
let rendering: Promise<unknown> = Promise.resolve()
let pollTimer: number | null = null
let unsubscribeBridge: (() => void) | null = null

function currentView(): HudView {
  return HUD_VIEWS[viewIndex]
}

async function connectBridgeWithTimeout(ms = 1800): Promise<EvenAppBridge | null> {
  try {
    const b = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), ms)),
    ])
    return b
  } catch {
    return null
  }
}

async function initG2Page(b: EvenAppBridge) {
  const { body, footer } = renderHudFrame(currentView(), market, paper)

  const bodyContainer = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 242,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 1,
    containerName: 'hud',
    content: body,
    isEventCapture: 1,
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
      containerTotalNum: 2,
      textObject: [bodyContainer, footerContainer],
    }),
  )
  if (res !== 0) {
    console.error('EvenPulse createStartUpPageContainer failed:', res)
  }
}

function pushHudUpdate() {
  const { body, footer } = renderHudFrame(currentView(), market, paper)
  renderCompanionUi(body, footer)

  if (!bridge) return
  const b = bridge
  rendering = rendering
    .then(async () => {
      await b.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 1,
          containerName: 'hud',
          content: body,
        }),
      )
      await b.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 2,
          containerName: 'footer',
          content: footer,
        }),
      )
    })
    .catch(err => console.error('G2 upgrade failed:', err))
}

function handleTap() {
  if (paper.activeBanner) {
    paper = confirmBannerOnG2(paper, market)
    pushHudUpdate()
    return
  }
  if (currentView() === 'MARKETS') {
    void refreshMarkets()
    return
  }
  viewIndex = (viewIndex + 1) % HUD_VIEWS.length
  pushHudUpdate()
}

function handleSwipe(delta: -1 | 1) {
  if (paper.activeBanner) return
  viewIndex = (viewIndex + delta + HUD_VIEWS.length) % HUD_VIEWS.length
  pushHudUpdate()
}

function handleDoubleTap() {
  if (bridge) {
    bridge.shutDownPageContainer(1)
  } else {
    paper = { ...paper, activeBanner: null, lastActionToast: 'Double-tap: Exit sent to G2' }
    pushHudUpdate()
  }
}

async function refreshMarkets() {
  market = await fetchAllMarkets(market)
  paper = seedPaperFromLive(paper, market)
  paper = evaluateAlerts(paper, market)
  pushHudUpdate()
}

function renderCompanionUi(body: string, footer: string) {
  const root = document.querySelector<HTMLDivElement>('#app')
  if (!root) return

  const { open, sessionTotal } = computePositions(paper, market)
  const pnlClass = sessionTotal >= 0 ? 'pos' : 'neg'
  const pnlText = `${sessionTotal >= 0 ? '+' : '-'}$${Math.abs(sessionTotal).toFixed(2)}`
  const btcSpread =
    market.assets.BTC.spreadBps !== null
      ? `${market.assets.BTC.spreadBps >= 0 ? '+' : ''}${market.assets.BTC.spreadBps.toFixed(1)} bps`
      : '--'

  root.innerHTML = `
    <div class="wrap">
      <header>
        <div>
          <h1>EvenPulse — Multi-Exchange G2 HUD</h1>
          <div class="subtitle">Track 03 · Exchanges &amp; Stocks · Read-Only Live Feeds + Paper Alerts</div>
        </div>
        <div class="pills">
          <span class="pill ${bridgeConnected ? 'ok' : ''}">${bridgeConnected ? 'G2 Bridge Connected' : 'Standalone Preview'}</span>
          <span class="pill ${market.sourcesOk.binance ? 'ok' : 'err'}">Binance</span>
          <span class="pill ${market.sourcesOk.coinbase ? 'ok' : 'err'}">Coinbase</span>
          <span class="pill ${market.sourcesOk.hyperliquid ? 'ok' : 'err'}">Hyperliquid</span>
        </div>
      </header>

      <section class="g2-frame" aria-label="Even G2 576x288 Monochrome Green HUD Mirror">
        <div class="g2-meta">
          <span>EVEN G2 · 576×288 MONOCHROME GREEN</span>
          <span>VIEW: ${currentView()} (${viewIndex + 1}/${HUD_VIEWS.length})</span>
        </div>
        <div class="g2-screen">
          <pre class="g2-body">${escapeHtml(body)}</pre>
          <div class="g2-footer">${escapeHtml(footer)}</div>
        </div>
      </section>

      <div class="controls">
        <button id="btn-prev">↑ Swipe Up</button>
        <button id="btn-next">↓ Swipe Down</button>
        <button id="btn-tap">● Tap G2</button>
        <button id="btn-demo-alert" class="primary">⚡ Test 1-Tap TP Alert</button>
        <button id="btn-reset">↺ Reset Paper</button>
      </div>

      <section class="card">
        <h2>Live Session Summary (Paper Trading · Zero Funds Held)</h2>
        <div class="grid-2">
          <div class="stat">
            <div class="label">Total Session PnL</div>
            <div class="val ${pnlClass}">${pnlText}</div>
          </div>
          <div class="stat">
            <div class="label">Open Paper Positions</div>
            <div class="val">${open.length} Active</div>
          </div>
          <div class="stat">
            <div class="label">BTC Coinbase–Binance Spread</div>
            <div class="val">${btcSpread}</div>
          </div>
          <div class="stat">
            <div class="label">BTC Perp Funding (APR)</div>
            <div class="val">${
              market.assets.BTC.fundingAprPct !== null
                ? `${market.assets.BTC.fundingAprPct >= 0 ? '+' : ''}${market.assets.BTC.fundingAprPct.toFixed(1)}%`
                : '--'
            }</div>
          </div>
        </div>
      </section>

      <footer class="note">
        EvenPulse uses public read-only exchange APIs (Binance Data Vision, Coinbase Exchange, Hyperliquid). No API keys, no custody, no real orders.
      </footer>
    </div>
  `

  document.getElementById('btn-prev')?.addEventListener('click', () => handleSwipe(-1))
  document.getElementById('btn-next')?.addEventListener('click', () => handleSwipe(1))
  document.getElementById('btn-tap')?.addEventListener('click', () => handleTap())
  document.getElementById('btn-demo-alert')?.addEventListener('click', () => {
    paper = triggerDemoTakeProfitAlert(paper, market)
    pushHudUpdate()
  })
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    paper = seedPaperFromLive(createInitialPaperState(), market)
    paper.lastActionToast = 'Paper positions reset to live prices'
    pushHudUpdate()
  })
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function cleanup() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
  if (unsubscribeBridge) {
    unsubscribeBridge()
    unsubscribeBridge = null
  }
}

async function boot() {
  pushHudUpdate()

  bridge = await connectBridgeWithTimeout(1800)
  if (bridge) {
    bridgeConnected = true
    await initG2Page(bridge)
    unsubscribeBridge = bridge.onEvenHubEvent(event => {
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
  pollTimer = window.setInterval(() => {
    void refreshMarkets()
  }, 8000)
}

void boot()
