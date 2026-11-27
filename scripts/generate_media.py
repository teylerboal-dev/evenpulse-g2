import os
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
DOCS = os.path.join(ROOT, "docs")
FRAMES = os.path.join(ROOT, "demo_frames")
UPLOAD_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\481e8976-b785-4f51-bfe6-4def9a1597b8\browser_sandbox\uploads"
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(DOCS, exist_ok=True)
os.makedirs(FRAMES, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

BG = (4, 12, 6)
FRAME_BG = (7, 19, 11)
GRID = (15, 48, 24)
DIM = (24, 128, 62)
MID = (36, 196, 98)
HI = (57, 255, 133)
WHITE = (232, 236, 244)
SLATE = (18, 24, 35)
BORDER = (39, 54, 72)

def load_font(size, bold=False):
    candidates = [
        r"C:\Windows\Fonts\consolab.ttf" if bold else r"C:\Windows\Fonts\consola.ttf",
        r"C:\Windows\Fonts\lucon.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

F_TITLE = load_font(28, bold=True)
F_BODY = load_font(24, bold=False)
F_SMALL = load_font(20, bold=False)
F_TINY = load_font(18, bold=True)

def make_logo():
    im = Image.new("RGB", (512, 512), BG)
    d = ImageDraw.Draw(im)
    # Outer waveguide ring
    d.rounded_rectangle([24, 24, 488, 488], radius=96, fill=(7, 22, 12), outline=HI, width=10)
    d.rounded_rectangle([48, 48, 464, 464], radius=76, fill=BG, outline=DIM, width=3)
    # Stylized G2 glasses dual-lens silhouette
    d.rounded_rectangle([78, 152, 238, 272], radius=26, fill=(10, 32, 17), outline=HI, width=6)
    d.rounded_rectangle([274, 152, 434, 272], radius=26, fill=(10, 32, 17), outline=HI, width=6)
    d.line([(238, 196), (274, 196)], fill=HI, width=8)
    # Pulse sparkline across both lenses
    pts = [(94, 232), (132, 228), (156, 184), (180, 248), (206, 200), (226, 214),
           (288, 214), (318, 236), (346, 174), (376, 242), (402, 192), (420, 206)]
    d.line(pts[:6], fill=HI, width=7)
    d.line(pts[6:], fill=HI, width=7)
    # Brand text
    f_big = load_font(54, bold=True)
    f_sub = load_font(26, bold=True)
    d.text((88, 316), "EVENPULSE", fill=HI, font=f_big)
    d.text((132, 392), "G2 MARKET HUD", fill=MID, font=f_sub)
    logo_path = os.path.join(ASSETS, "evenpulse-logo.png")
    im.save(logo_path)
    shutil.copy2(logo_path, os.path.join(UPLOAD_DIR, "evenpulse-logo.png"))
    return logo_path

def draw_g2_screen(filename, top_lines, status_lines, footer_text, chart_fn, subtitle):
    W, H = 1152, 576
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    # Outer bezel
    d.rounded_rectangle([12, 12, W - 12, H - 12], radius=22, fill=FRAME_BG, outline=DIM, width=4)
    # Top meta bar
    d.text((34, 24), f"EVEN REALITIES G2 · 576x288 MONOCHROME GREEN · {subtitle}", fill=DIM, font=F_TINY)
    # Container 1: Top HUD (y: 56..304)
    d.rounded_rectangle([28, 56, W - 28, 304], radius=10, fill=BG, outline=GRID, width=2)
    y = 70
    for idx, line in enumerate(top_lines):
        col = HI if idx == 0 else (MID if line.startswith("---") else HI)
        d.text((46, y), line, fill=col, font=F_BODY)
        y += 38
    # Container 4: Bottom-left status (x: 28..728, y: 316..496)
    d.rounded_rectangle([28, 316, 728, 496], radius=10, fill=BG, outline=GRID, width=2)
    sy = 334
    for line in status_lines:
        d.text((46, sy), line, fill=MID, font=F_SMALL)
        sy += 38
    # Container 3: Bottom-right 4-bit ImageContainer (x: 744..1124, y: 316..496 -> 380x180 scaled 2x of 200x96)
    box = (744, 316, 1124, 496)
    d.rounded_rectangle(box, radius=10, fill=BG, outline=MID, width=2)
    chart_fn(d, box)
    # Container 2: Footer (y: 508..552)
    d.line([(28, 508), (W - 28, 508)], fill=DIM, width=2)
    d.text((36, 518), footer_text, fill=MID, font=F_SMALL)

    out_path = os.path.join(ASSETS, filename)
    im.save(out_path)
    return out_path

def chart_sparkline(d, box):
    x0, y0, x1, y1 = box
    d.text((x0 + 14, y0 + 10), "BTC 15m  +1.42%   WS", fill=HI, font=F_TINY)
    vals = [90420, 90510, 90480, 90690, 90840, 90790, 91020, 91180, 91110, 91340, 91520, 91690]
    lo, hi = min(vals), max(vals)
    pts = []
    for i, v in enumerate(vals):
        px = x0 + 16 + int(i / (len(vals) - 1) * (x1 - x0 - 32))
        py = y0 + 138 - int((v - lo) / (hi - lo) * 86)
        pts.append((px, py))
    d.line(pts, fill=HI, width=4)
    d.text((x0 + 14, y1 - 28), f"L:{lo}      H:{hi}", fill=MID, font=F_TINY)

def chart_liq_gauges(d, box):
    x0, y0, x1, y1 = box
    d.text((x0 + 14, y0 + 10), "LIQ SAFETY · +$418", fill=HI, font=F_TINY)
    rows = [("BTC", 0.72, "21.6%"), ("ETH", 0.64, "19.2%"), ("SOL", 0.85, "25.4%")]
    for i, (sym, r, pct) in enumerate(rows):
        ry = y0 + 46 + i * 42
        d.text((x0 + 14, ry), sym, fill=MID, font=F_TINY)
        bx0, bx1 = x0 + 76, x1 - 86
        d.rectangle([bx0, ry + 2, bx1, ry + 22], outline=DIM, width=2)
        d.rectangle([bx0 + 3, ry + 5, bx0 + 3 + int((bx1 - bx0 - 6) * r), ry + 19], fill=HI if r < 0.7 else MID)
        d.text((bx1 + 10, ry), pct, fill=HI, font=F_TINY)

def chart_spreads(d, box):
    x0, y0, x1, y1 = box
    d.text((x0 + 14, y0 + 10), "4-VENUE SPREAD (BPS)", fill=HI, font=F_TINY)
    cx = x0 + 235
    d.line([(cx, y0 + 38), (cx, y1 - 14)], fill=DIM, width=2)
    rows = [("BTC", "+9.4", 0.62), ("ETH", "+4.2", 0.28), ("SOL", "-3.1", -0.22), ("BNB", "+1.8", 0.14)]
    for i, (sym, txt, r) in enumerate(rows):
        ry = y0 + 44 + i * 32
        d.text((x0 + 14, ry), f"{sym} {txt}", fill=MID, font=F_TINY)
        bar = int(abs(r) * 110)
        col = HI if abs(r) > 0.5 else MID
        if r >= 0:
            d.rectangle([cx + 2, ry + 2, cx + 2 + bar, ry + 18], fill=col)
        else:
            d.rectangle([cx - 2 - bar, ry + 2, cx - 2, ry + 18], fill=col)

def chart_safety_gate(d, box):
    x0, y0, x1, y1 = box
    d.text((x0 + 14, y0 + 10), "SAFETY GATE · DEFAULT-NO", fill=HI, font=F_TINY)
    d.text((x0 + 14, y0 + 38), "AUTO-CANCEL IN 24s", fill=MID, font=F_TINY)
    d.rectangle([x0 + 14, y0 + 68, x1 - 14, y0 + 96], outline=MID, width=2)
    d.rectangle([x0 + 18, y0 + 72, x0 + 18 + int((x1 - x0 - 36) * 0.8), y0 + 92], fill=HI)
    d.rectangle([x0 + 14, y0 + 114, x0 + 180, y0 + 158], fill=GRID, outline=DIM, width=2)
    d.text((x0 + 28, y0 + 126), " [NO] SAFE", fill=DIM, font=F_TINY)
    d.rectangle([x0 + 196, y0 + 114, x1 - 14, y0 + 158], fill=HI, outline=HI, width=2)
    d.text((x0 + 206, y0 + 126), ">[YES] RUN", fill=BG, font=F_TINY)

def make_architecture():
    W, H = 1200, 620
    im = Image.new("RGB", (W, H), SLATE)
    d = ImageDraw.Draw(im)
    d.text((40, 28), "EvenPulse v2.0 — Architecture & Read/Write Safety Flow", fill=WHITE, font=F_TITLE)
    d.text((40, 66), "4 Public Exchanges (Zero Keys) -> Local Intent & Default-NO Gate -> Even Hub SDK (4 Containers)", fill=MID, font=F_SMALL)

    boxes = [
        (40, 130, 340, 520, "1. LIVE PUBLIC FEEDS\n(ZERO API KEYS)", [
            "• Binance WebSocket",
            "  + 15m Klines (Sparkline)",
            "• OKX Spot REST",
            "• Coinbase USD Spot",
            "• Hyperliquid Perp Mark",
            "  + Funding APR",
            "",
            "100% Read-Only & CORS",
        ]),
        (420, 130, 770, 520, "2. VOICE & SAFETY ENGINE\n(100% LOCAL)", [
            "• Voice PTT (audioControl)",
            "  16kHz PCM Energy Meter",
            "• Local Intent Parser:",
            '  "Reduce BTC 50%"',
            '  "Alert BTC > 95k"',
            "• Default-NO 30s Gate:",
            "  Swipe [NO]->[YES] + Tap",
            "• Immutable Audit Log",
        ]),
        (850, 130, 1160, 520, "3. EVEN G2 DISPLAY\n(576x288 WAVEGUIDE)", [
            "• Container 1 (576x142):",
            "  Primary HUD Table",
            "• Container 4 (366x96):",
            "  Voice / Session Status",
            "• Container 3 (200x96):",
            "  4-Bit ImageRawData PNG",
            "• Container 2 (576x36):",
            "  Temple/R1 Gesture Bar",
        ]),
    ]
    for x0, y0, x1, y1, title, items in boxes:
        d.rounded_rectangle([x0, y0, x1, y1], radius=16, fill=(10, 18, 26), outline=HI, width=3)
        d.rounded_rectangle([x0, y0, x1, y0 + 72], radius=16, fill=(11, 40, 22), outline=HI, width=2)
        d.text((x0 + 18, y0 + 14), title, fill=HI, font=F_TINY)
        iy = y0 + 96
        for it in items:
            d.text((x0 + 18, iy), it, fill=WHITE if it.startswith("•") else MID, font=F_SMALL)
            iy += 36

    # Arrows
    for ax in (346, 776):
        d.line([(ax, 325), (ax + 68, 325)], fill=HI, width=5)
        d.polygon([(ax + 68, 325), (ax + 52, 313), (ax + 52, 337)], fill=HI)

    d.text((40, 558), "Tracks: 03 Exchanges & Stocks + 02 Crypto & DeFi  |  Zero Custody  |  Open Source MIT", fill=MID, font=F_SMALL)
    out = os.path.join(ASSETS, "architecture.png")
    im.save(out)
    return out

def main():
    make_logo()
    s1 = draw_g2_screen(
        "screen-markets-sparkline.png",
        [
            "EVENPULSE MARKETS     WS 10:42:18",
            "ASSET  SPOT(BIN)    24H      HL FUND APR",
            "----------------------------------------",
            "BTC    $91,690.5    +2.41%   +11.8%",
            "ETH    $3,184.2     +3.12%   +14.2%",
            "SOL    $214.85      +5.64%   +18.5%",
        ],
        [
            "FEEDS: 4/4 LIVE (WS)",
            "SESSION: +$418.40 (3 OPEN)",
            'VOICE: "Reduce BTC 50%"',
        ],
        "[1/4] MARKETS · Tap: Refresh · Swipe: View · 2xTap: Exit",
        chart_sparkline,
        "1/4 MARKETS + 4-BIT SPARKLINE",
    )
    s2 = draw_g2_screen(
        "screen-positions-liq.png",
        [
            "POSITIONS & RISK     +$418.40",
            "POS         MARK        PnL       LIQ%",
            "----------------------------------------",
            "BTC L5x     $91,690.5   +$320.90  21.6%",
            "ETH L4x     $3,184.2    +$76.40   19.2%",
            "SOL S3x     $214.85     +$21.10   25.4%",
        ],
        [
            "FEEDS: 4/4 LIVE (WS)",
            "SESSION: +$418.40 (3 OPEN)",
            "> Risk healthy · All liq > 19%",
        ],
        "[2/4] POSITIONS · Tap: Next · Swipe: View · 2xTap: Exit",
        chart_liq_gauges,
        "2/4 POSITIONS & LIQ GAUGES",
    )
    s3 = draw_g2_screen(
        "screen-spreads-4venue.png",
        [
            "4-VENUE SPREADS       WS 10:42:22",
            "ASSET  BINANCE     REF(CB/OKX)  SPREAD",
            "----------------------------------------",
            "BTC    $91,690.5   $91,776.7    +9.4bp",
            "ETH    $3,184.2    $3,197.6     +4.2bp",
            "SOL    $214.85     $214.18      -3.1bp",
        ],
        [
            "FEEDS: 4/4 LIVE (WS)",
            "SIGNAL: CB PREMIUM > 8 BPS",
            "> Arb window open (Read-Only)",
        ],
        "[3/4] SPREADS · Tap: Next · Swipe: View · 2xTap: Exit",
        chart_spreads,
        "3/4 4-VENUE SPREADS",
    )
    s4 = draw_g2_screen(
        "screen-voice-safety-gate.png",
        [
            "[!] SAFETY GATE (24s) · DEFAULT-NO",
            "REDUCE 50%: BTC LONG 5x",
            "----------------------------------------",
            "Trim 0.125 @ $91,690.5 (+$160.45)",
            "   [NO] Cancel      >> [YES] EXECUTE <<",
        ],
        [
            "WRITE PROTECTION ACTIVE",
            "Swipe: Toggle [NO]/[YES]",
            "Tap: Confirm highlighted",
            "Auto-cancels in 24s",
        ],
        "SAFETY GATE · Swipe: NO/YES · Tap: Confirm · 2xTap: Exit",
        chart_safety_gate,
        "VOICE -> DEFAULT-NO SAFETY GATE",
    )
    arch = make_architecture()

    # Rebuild docs/evenpulse-demo.mp4 with ffmpeg if available
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        concat_file = os.path.join(FRAMES, "v2_concat.txt")
        slides = [(s1, 4), (s2, 4), (s3, 4), (s4, 5), (arch, 5)]
        with open(concat_file, "w", encoding="utf-8") as f:
            for p, dur in slides:
                f.write(f"file '{p.replace(chr(92), '/')}'\n")
                f.write(f"duration {dur}\n")
            f.write(f"file '{slides[-1][0].replace(chr(92), '/')}'\n")
        mp4_out = os.path.join(DOCS, "evenpulse-demo.mp4")
        subprocess.run(
            [
                ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", concat_file,
                "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#040c06,format=yuv420p",
                "-c:v", "libx264", "-r", "30", "-movflags", "+faststart", mp4_out
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print("Generated MP4:", mp4_out, os.path.getsize(mp4_out))
    else:
        print("ffmpeg not found; kept existing MP4")
    print("Generated all EvenPulse v2.0 media assets OK")

if __name__ == "__main__":
    main()
