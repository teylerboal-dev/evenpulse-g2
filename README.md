# EvenPulse — Live Multi-Exchange HUD for Even Realities G2

**Track 03 · Exchanges & Stocks** (Heads Up: Even Realities Hackathon)

EvenPulse turns **Even Realities G2** smart glasses (`576 × 288` monochrome green micro-OLED) into a zero-friction, heads-up trading & market-monitoring cockpit backed by **live public exchange feeds** from **Binance**, **Coinbase**, and **Hyperliquid** — with **zero API keys**, **zero custody**, and **1-tap paper-trading alerts**.

---

## Problem & Target User

Active crypto and perpetuals traders constantly pull out their phone during meetings, commutes, or away-from-desk sessions just to check:
1. Live spot/perp prices & funding rates across venues,
2. Whether **Coinbase Premium / cross-exchange spreads** are widening,
3. Current **session PnL** and **distance to liquidation**,
4. Whether a price or take-profit alert fired.

Existing mobile exchange apps require unlocking a phone, opening an app, and parsing dense charts. **EvenPulse** distills multi-exchange state into **4 glanceable, monospaced monochrome-green views** controlled strictly with G2 temple/R1-ring gestures.

---

## Key Features (4 Glanceable G2 Views)

| View | What You See on the `576 × 288` G2 Lens | Gesture |
|---|---|---|
| **1/4 · MARKETS** | Live **Binance** spot price, 24h % change, and **Hyperliquid** annualized perp funding APR across `BTC / ETH / SOL / BNB` | Tap: Force refresh · Swipe: Next view |
| **2/4 · POSITIONS** | Live **Session PnL (`+$ / -$`)**, open paper positions (venue, leverage, mark price, unrealized PnL) & **Liquidation Distance %** | Swipe Up/Down: Switch views |
| **3/4 · SPREADS** | Real-time **Coinbase vs Binance Premium** (`bps`) & Hyperliquid mark basis — instant flow / arb signal | Swipe Up/Down: Switch views |
| **4/4 · ALERTS** | Armed & triggered price / spread alerts + **1-Tap G2 Confirm Overlay** to acknowledge alerts or execute a **1-tap paper take-profit close** | Tap on Alert Overlay: Confirm / Close |

- **Universal Exit**: Double-tap at any time calls `bridge.shutDownPageContainer(1)` cleanly.
- **Safety First**: 100% read-only public market data + paper-trading simulation. Never holds funds, never requests exchange API keys, and commits zero secrets.

---

## Live Exchange Data Sources (100% Public, CORS-Enabled, Zero Keys)

| Venue | Endpoint | Data |
|---|---|---|
| **Binance** | `https://data-api.binance.vision/api/v3/ticker/24hr` | Live spot prices & 24h % change (`BTC`, `ETH`, `SOL`, `BNB`) |
| **Coinbase** | `https://api.exchange.coinbase.com/products/{PAIR}/stats` | Live USD spot prices for Coinbase–Binance spread (`bps`) |
| **Hyperliquid** | `https://api.hyperliquid.xyz/info` (`metaAndAssetCtxs`) | Live perp mark prices & hourly funding rates (annualized APR) |

---

## Quick Start (Official Even Hub Simulator)

### Prerequisites
- Node.js v18+

### Run Locally in the Even Hub Simulator
```bash
git clone https://github.com/teylerboal-dev/evenpulse-g2.git
cd evenpulse-g2
npm install
npm run dev
```
In a second terminal, launch the official Even Hub desktop simulator:
```bash
npm run simulate
# (runs: evenhub-simulator http://localhost:5173)
```
Or open `http://localhost:5173` directly in any browser to use the built-in **Standalone `576 × 288` G2 Monochrome Green Mirror** with interactive Swipe / Tap / Test 1-Tap TP Alert controls!

### Build & Package `.ehpk`
```bash
npm run build   # TypeScript typecheck + Vite production bundle
npm run pack    # Packages app.json + dist/ into an Even Hub .ehpk archive
```

---

## Architecture

- Built on the official `@evenrealities/even_hub_sdk` (`v0.0.10`) and `@evenrealities/evenhub-cli` (`v0.1.12`).
- Uses `waitForEvenAppBridge()`, `CreateStartUpPageContainer` (2 stacked `TextContainerProperty` regions: `576×242` HUD + `576×36` persistent footer), serialized `textContainerUpgrade` writes, and protobuf-zero-safe `eventTypeOf(envelope)` routing for `CLICK_EVENT`, `SCROLL_TOP_EVENT`, `SCROLL_BOTTOM_EVENT`, and `DOUBLE_CLICK_EVENT`.
- Automatically falls back to a standalone interactive `576×288` G2 lens preview when opened outside Even App / `evenhub-simulator` (e.g., on GitHub Pages).

## Pre-Existing Libraries & Code Disclosure

Per hackathon rules, all application code (`src/exchanges.ts`, `src/paper.ts`, `src/g2-renderer.ts`, `src/main.ts`, `index.html`, `app.json`) was written fresh during the hackathon (Nov 26, 2026). Pre-existing open-source dependencies used:
- `@evenrealities/even_hub_sdk`, `@evenrealities/evenhub-cli`, `@evenrealities/evenhub-simulator` (official Even Realities SDK & tooling; event routing pattern adapted from `even-realities/evenhub-templates` MIT template)
- `vite`, `typescript`

## License
MIT
