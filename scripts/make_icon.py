"""Generate app icons for SIGNAL.

Design: dark #0a0a0a rounded-square background, clean white/light-gray globe
outline (limb + equator + two meridians), with three small green wifi/signal
arcs radiating UP from the top of the globe. Simple and minimal.

Outputs at the project root:
  apple-touch-icon.png  180x180
  favicon.png            32x32
  icon-192.png          192x192
"""
from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFilter

SIZE = 180
FAVICON_SIZE = 32

BG = (10, 10, 10, 255)              # #0a0a0a
GLOBE = (235, 238, 244, 255)        # near-white
GLOBE_SOFT = (160, 168, 180, 255)   # light gray for inner meridians/equator
GREEN = (48, 211, 122, 255)         # signal green
GREEN_GLOW = (48, 211, 122, 180)

# Render at 4x then downsample for clean antialiasing.
SCALE = 4
W = SIZE * SCALE


def rounded_square(size: int, radius: int, fill: tuple[int, int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return img


def draw_globe(canvas: Image.Image, cx: int, cy: int, r: int) -> None:
    """Crisp white globe: outer limb + equator + two meridians."""
    d = ImageDraw.Draw(canvas)

    limb_w = max(2, int(W * 0.014))
    line_w = max(1, int(W * 0.008))

    # Outer limb (planet edge)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=GLOBE, width=limb_w)

    # Equator (flat horizontal ellipse)
    d.ellipse(
        (cx - r, cy - int(r * 0.16), cx + r, cy + int(r * 0.16)),
        outline=GLOBE_SOFT,
        width=line_w,
    )

    # Two meridians at different tilts to suggest a sphere
    for tilt in (0.42, 0.78):
        d.ellipse(
            (cx - int(r * tilt), cy - r, cx + int(r * tilt), cy + r),
            outline=GLOBE_SOFT,
            width=line_w,
        )


def draw_signal_waves(canvas: Image.Image, cx: int, top_y: int) -> None:
    """Three small green wifi/signal arcs above the top of the globe.

    `top_y` is the y-coord of the topmost point of the globe limb. Arcs are
    centered horizontally on `cx` and stack upward in increasing radius.
    Each arc is drawn as a small portion of a circle (≈ ±32° from straight up)
    so it reads as a wifi-style signal fan.
    """
    # Arc geometry — anchor the arc-circles slightly above the globe top so
    # the fan is visually centered and doesn't graze the limb.
    anchor_y = top_y - int(W * 0.005)
    radii = [int(W * 0.085), int(W * 0.135), int(W * 0.185)]
    arc_w = max(3, int(W * 0.020))

    # Arc spans from 238° to 302° (i.e. centered on 270° which is straight up
    # in PIL's coord system where 0° = east, 90° = south).
    start_deg, end_deg = 238, 302

    # Soft glow underneath
    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    glow_w = arc_w + max(4, int(W * 0.018))
    for r in radii:
        gd.arc(
            (cx - r, anchor_y - r, cx + r, anchor_y + r),
            start=start_deg,
            end=end_deg,
            fill=GREEN_GLOW,
            width=glow_w,
        )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=W * 0.012))
    canvas.alpha_composite(glow)

    # Crisp arcs on top
    d = ImageDraw.Draw(canvas)
    for r in radii:
        d.arc(
            (cx - r, anchor_y - r, cx + r, anchor_y + r),
            start=start_deg,
            end=end_deg,
            fill=GREEN,
            width=arc_w,
        )

    # Optional small dot at the source for that wifi-icon feel.
    dot_r = max(3, int(W * 0.018))
    dot_y = anchor_y + max(2, int(W * 0.004))
    d.ellipse((cx - dot_r, dot_y - dot_r, cx + dot_r, dot_y + dot_r), fill=GREEN)


def build_icon() -> Image.Image:
    # Dark rounded-square background (~22% radius like iOS).
    canvas = rounded_square(W, int(W * 0.22), BG)

    # Globe centered and sized to leave room above for the wave fan.
    globe_r = int(W * 0.30)
    cx = W // 2
    # Push the globe slightly down so the waves get visual room above it.
    cy = int(W * 0.58)

    draw_signal_waves(canvas, cx=cx, top_y=cy - globe_r)
    draw_globe(canvas, cx=cx, cy=cy, r=globe_r)

    # Downsample for crisp antialiasing.
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.abspath(os.path.join(here, ".."))

    icon = build_icon()
    icon.save(os.path.join(out_dir, "apple-touch-icon.png"), "PNG", optimize=True)

    fav = icon.resize((FAVICON_SIZE, FAVICON_SIZE), Image.LANCZOS)
    fav.save(os.path.join(out_dir, "favicon.png"), "PNG", optimize=True)

    fav192 = icon.resize((192, 192), Image.LANCZOS)
    fav192.save(os.path.join(out_dir, "icon-192.png"), "PNG", optimize=True)

    print("Wrote:")
    for name in ("apple-touch-icon.png", "favicon.png", "icon-192.png"):
        p = os.path.join(out_dir, name)
        print(f"  {p}  ({os.path.getsize(p)} bytes)")


if __name__ == "__main__":
    main()
