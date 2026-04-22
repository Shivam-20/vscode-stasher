#!/usr/bin/env python3
"""
Generate resources/icon.png — the VS Code Marketplace extension icon.
128×128 px, purple-violet gradient background, white stash icon.
Render at 512×512 (4× AA) then downsample to 128×128 via LANCZOS.
"""

import os
from PIL import Image, ImageDraw

# ── Config ────────────────────────────────────────────────────────────────────
SIZE   = 512        # working canvas (4× super-sampling)
OUT    = 128        # final pixel size
BG_R   = 90         # background corner radius at SIZE scale
TOP_C  = (124, 58, 237)   # #7C3AED  vivid violet (top)
BOT_C  = ( 76, 29, 149)   # #4C1D95  deep purple  (bottom)
W      = (255, 255, 255, 255)   # icon colour: white

# ── Background gradient ───────────────────────────────────────────────────────
img  = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

for y in range(SIZE):
    t = y / (SIZE - 1)
    r = round(TOP_C[0] + (BOT_C[0] - TOP_C[0]) * t)
    g = round(TOP_C[1] + (BOT_C[1] - TOP_C[1]) * t)
    b = round(TOP_C[2] + (BOT_C[2] - TOP_C[2]) * t)
    draw.line([(0, y), (SIZE - 1, y)], fill=(r, g, b, 255))

# Round corners via alpha mask
mask      = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=BG_R, fill=255)
img.putalpha(mask)

draw = ImageDraw.Draw(img)   # re-create after putalpha

# ── Icon geometry ─────────────────────────────────────────────────────────────
# Map SVG 24×24 units to pixel coords.
# Icon occupies the central 310×310 px of the 512×512 canvas (M=101 px margin).
M = 101
S = (SIZE - 2 * M) / 24    # scale factor ≈ 12.917 px per SVG unit

def gx(v): return round(M + v * S)
def gy(v): return round(M + v * S)
def gr(v): return max(1, round(v * S))

SW = gr(1.5)    # stroke width for body outline

# 1. Body outline (drawn first so lid can cover its top border)
draw.rounded_rectangle(
    [gx(3), gy(9), gx(21), gy(23)],
    radius=gr(1.5),
    fill=None,
    outline=W,
    width=SW,
)

# 2. Handle (protrudes above lid)
draw.rounded_rectangle(
    [gx(9.5), gy(0.75), gx(14.5), gy(3.25)],
    radius=gr(1.25),
    fill=W,
)

# 3. Lid (filled white, covers the body's top border)
draw.rounded_rectangle(
    [gx(2), gy(2.5), gx(22), gy(9.5)],
    radius=gr(1.5),
    fill=W,
)

# 4. Stash entry bars inside the body
#    Bar 1: widest → most recent stash
draw.rounded_rectangle(
    [gx(7), gy(13.5), gx(17), gy(15.25)],
    radius=gr(0.875),
    fill=W,
)
#    Bar 2: narrower → older stash
draw.rounded_rectangle(
    [gx(7), gy(18), gx(14), gy(19.75)],
    radius=gr(0.875),
    fill=W,
)

# ── Resize and save ───────────────────────────────────────────────────────────
out_dir  = os.path.join(os.path.dirname(__file__), "..", "resources")
out_path = os.path.abspath(os.path.join(out_dir, "icon.png"))

img.resize((OUT, OUT), Image.LANCZOS).save(out_path)
print(f"Saved {OUT}×{OUT} icon → {out_path}")
