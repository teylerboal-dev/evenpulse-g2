import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Compile TS modules into a temp ESM bundle with esbuild/tsc or test pure logic via Vite's bundled output?
// Use Node's built-in strip-types or compile via npx tsc to .test-dist for zero extra deps.
const testDist = path.resolve('.test-dist')
fs.rmSync(testDist, { recursive: true, force: true })
execSync(
  'npx tsc src/exchanges.ts src/paper.ts src/voice.ts src/g2-renderer.ts --outDir .test-dist --module esnext --target es2022 --moduleResolution bundler --skipLibCheck',
  { stdio: 'pipe' },
)
// Add .js extension to relative imports inside .test-dist for Node ESM
for (const file of fs.readdirSync(testDist)) {
  if (!file.endsWith('.js')) continue
  const full = path.join(testDist, file)
  const content = fs.readFileSync(full, 'utf8').replace(/from '(\.\/[^']+)'/g, "from '$1.js'")
  fs.writeFileSync(full, content, 'utf8')
}

const { createInitialMarketState, applyLiveWsTick, recomputeAssetSpread } = await import(
  '../.test-dist/exchanges.js'
)
const {
  createInitialPaperState,
  seedPaperFromLive,
  computePositions,
  draftReduceHalfBanner,
  toggleBannerOption,
  confirmBannerOnG2,
  expireBannerIfNeeded,
  SAFETY_GATE_TTL_MS,
} = await import('../.test-dist/paper.js')
const { parseVoiceCommand, computePcmEnergy } = await import('../.test-dist/voice.js')
const { renderHudFrame } = await import('../.test-dist/g2-renderer.js')

describe('EvenPulse v2.0 Core Logic', () => {
  test('computes cross-venue spreads and live WebSocket updates accurately', () => {
    let m = createInitialMarketState()
    m.assets.BTC.binancePrice = 100000
    m.assets.BTC.coinbasePrice = 100120
    m.assets.BTC = recomputeAssetSpread(m.assets.BTC)
    assert.equal(m.assets.BTC.spreadUsd, 120)
    assert.equal(Math.round(m.assets.BTC.spreadBps * 10) / 10, 12.0)
    assert.equal(m.assets.BTC.spreadVenue, 'CB')

    m = applyLiveWsTick(m, 'BTC', 100050, 2.5)
    assert.equal(m.assets.BTC.binancePrice, 100050)
    assert.equal(m.wsConnected, true)
    assert.equal(m.assets.BTC.spreadUsd, 70)
  })

  test('enforces Default-NO 30s safety gate on Reduce 50% and executes only when toggled to YES', () => {
    let m = createInitialMarketState()
    m.assets.BTC.binancePrice = 90000
    m.assets.ETH.binancePrice = 3000
    m.assets.SOL.binancePrice = 200

    let p = seedPaperFromLive(createInitialPaperState(), m)
    const beforeQty = p.positions.find(x => x.symbol === 'BTC').qty

    // Draft reduce 50% -> defaults to NO
    const t0 = 1_000_000
    p = draftReduceHalfBanner(p, m, 'BTC', t0)
    assert.equal(p.activeBanner.selectedOption, 'NO')

    // Confirm while NO -> safely cancels without mutating position
    p = confirmBannerOnG2(p, m, t0 + 2000)
    assert.equal(p.activeBanner, null)
    assert.equal(p.positions.find(x => x.symbol === 'BTC').qty, beforeQty)

    // Draft again, swipe to YES, confirm -> halves position and realizes PnL
    p = draftReduceHalfBanner(p, m, 'BTC', t0 + 5000)
    p = toggleBannerOption(p)
    assert.equal(p.activeBanner.selectedOption, 'YES')
    p = confirmBannerOnG2(p, m, t0 + 6000)
    assert.equal(p.positions.find(x => x.symbol === 'BTC').qty, Number((beforeQty / 2).toFixed(4)))
    assert.ok(p.auditLog.length >= 2)

    // Auto-expiry after 30s cancels safely
    p = draftReduceHalfBanner(p, m, 'BTC', t0 + 10_000)
    p = toggleBannerOption(p)
    p = expireBannerIfNeeded(p, t0 + 10_000 + SAFETY_GATE_TTL_MS + 1)
    assert.equal(p.activeBanner, null)
    assert.ok(p.lastActionToast.includes('expired'))
  })

  test('parses natural voice commands and computes PCM energy', () => {
    assert.deepEqual(parseVoiceCommand('Reduce BTC 50 percent'), {
      kind: 'REDUCE_HALF',
      symbol: 'BTC',
      transcript: 'Reduce BTC 50 percent',
    })
    assert.deepEqual(parseVoiceCommand('Alert BTC above 95k'), {
      kind: 'ADD_PRICE_ALERT',
      symbol: 'BTC',
      condition: 'ABOVE',
      threshold: 95000,
      transcript: 'Alert BTC above 95k',
    })
    assert.deepEqual(parseVoiceCommand('Alert spread above 12 bps'), {
      kind: 'ADD_SPREAD_ALERT',
      thresholdBps: 12,
      transcript: 'Alert spread above 12 bps',
    })
    assert.deepEqual(parseVoiceCommand('Show spreads'), {
      kind: 'NAVIGATE',
      view: 'SPREADS',
      transcript: 'Show spreads',
    })

    const pcm = new Uint8Array(64)
    const dv = new DataView(pcm.buffer)
    for (let i = 0; i < 32; i++) dv.setInt16(i * 2, 10000, true)
    assert.ok(computePcmEnergy(pcm) > 0.5)
  })

  test('renders all 4 G2 HUD views and Safety Gate frame cleanly', () => {
    let m = createInitialMarketState()
    m.assets.BTC.binancePrice = 91234.5
    m.assets.ETH.binancePrice = 3120.4
    m.assets.SOL.binancePrice = 198.2
    m.assets.BNB.binancePrice = 610.5
    const p = seedPaperFromLive(createInitialPaperState(), m)
    const posStats = computePositions(p, m)
    assert.equal(posStats.open.length, 3)

    for (const v of ['MARKETS', 'POSITIONS', 'SPREADS', 'ALERTS']) {
      const frame = renderHudFrame(v, m, p)
      assert.ok(frame.body.length > 20)
      assert.ok(frame.status.length > 10)
      assert.ok(frame.footer.includes(v))
    }

    const gated = draftReduceHalfBanner(p, m, 'BTC', 5000)
    const gFrame = renderHudFrame('POSITIONS', m, gated, { nowMs: 6000 })
    assert.ok(gFrame.body.includes('DEFAULT-NO'))
    assert.ok(gFrame.body.includes('>> [NO] CANCEL <<'))
  })
})
