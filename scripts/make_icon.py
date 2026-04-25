"""Generate apple-touch-icon.png and favicon.png for SIGNAL.

Design: dark background, minimalist globe (outer ring + 3 meridian/equator
lines), one red great-circle arc and one green great-circle arc crossing the
globe. Perfectly centered on a 180x180 canvas (also exports a 32x32 favicon).
"""
from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFilter

SIZE = 180
FAVICON_SIZE = 32

BG = (14, 16, 20, 255)              # --bg
GLOBE_LINE = (110, 118, 133, 255)   # --ink-mute
GLOBE_LINE_SOFT = (52, 59, 71, 255) # --line-strong
GREEN = (48, 211, 122, 255)         # --bull
RED = (241, 74, 62, 255)            # --bear

# Render at 4x then downsample for clean antialiasing.
SCALE = 4
W = SIZE * SCALE


def rounded_square(size: int, radius: int, fill: tuple[int, int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return img


def draw_globe(canvas: Image.Image) -> None:
    d = ImageDraw.Draw(canvas)
    cx = cy = W // 2
    # Globe radius — leave breathing room from the edges.
    r = int(W * 0.34)

    # Outer ring (the planet's limb).
    ring_w = max(2, int(W * 0.012))
    d.ellipse(
        (cx - r, cy - r, cx + r, cy + r),
        outline=GLOBE_LINE,
        width=ring_w,
    )

    # Equator + two meridian ellipses to suggest a sphere.
    line_w = max(1, int(W * 0.006))
    # Equator (flat horizontal ellipse).
    d.ellipse(
        (cx - r, cy - int(r * 0.18), cx + r, cy + int(r * 0.18)),
        outline=GLOBE_LINE_SOFT,
        width=line_w,
    )
    # Two meridians at different "tilts".
    for tilt in (0.45, 0.78):
        d.ellipse(
            (cx - int(r * tilt), cy - r, cx + int(r * tilt), cy + r),
            outline=GLOBE_LINE_SOFT,
            width=line_w,
        )


def great_circle_points(
    lon1: float, lat1: float, lon2: float, lat2: float, n: int = 80
) -> list[tuple[float, float, float]]:
    """Return list of (x, y, z) on unit sphere along a great-circle arc.

    Uses spherical linear interpolation between two unit vectors.
    """
    def to_xyz(lon: float, lat: float) -> tuple[float, float, float]:
        lon_r = math.radians(lon)
        lat_r = math.radians(lat)
        return (
            math.cos(lat_r) * math.cos(lon_r),
            math.cos(lat_r) * math.sin(lon_r),
            math.sin(lat_r),
        )

    a = to_xyz(lon1, lat1)
    b = to_xyz(lon2, lat2)
    dot = max(-1.0, min(1.0, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
    omega = math.acos(dot)
    if omega < 1e-6:
        return [a, b]
    sin_o = math.sin(omega)
    out = []
    for i in range(n + 1):
        t = i / n
        s1 = math.sin((1 - t) * omega) / sin_o
        s2 = math.sin(t * omega) / sin_o
        out.append((
            s1 * a[0] + s2 * b[0],
            s1 * a[1] + s2 * b[1],
            s1 * a[2] + s2 * b[2],
        ))
    return out


def project(xyz_pts, cx: int, cy: int, r: int):
    """Orthographic projection from camera on +x axis looking toward origin.

    World frame: x=cos(lat)cos(lon), y=cos(lat)sin(lon), z=sin(lat).
    Camera at +x means lon=0,lat=0 sits dead center.
      screen_x =  y
      screen_y = -z
    Visible when x >= 0 (front hemisphere).
    """
    segs: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    for x, y, z in xyz_pts:
        if x >= -0.02:
            cur.append((cx + y * r, cy - z * r))
        else:
            if len(cur) > 1:
                segs.append(cur)
            cur = []
    if len(cur) > 1:
        segs.append(cur)
    return segs


def draw_arc(canvas: Image.Image, lon1, lat1, lon2, lat2, color, glow_color):
    cx = cy = W // 2
    r = int(W * 0.34)
    pts = great_circle_points(lon1, lat1, lon2, lat2, n=120)
    segs = project(pts, cx, cy, r)
    if not segs:
        return

    # Soft outer glow (drawn on a separate layer then blurred).
    glow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow_layer)
    glow_w = max(6, int(W * 0.04))
    for seg in segs:
        gd.line(seg, fill=glow_color, width=glow_w, joint="curve")
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=W * 0.012))
    canvas.alpha_composite(glow_layer)

    # Crisp arc on top.
    d = ImageDraw.Draw(canvas)
    arc_w = max(2, int(W * 0.018))
    for seg in segs:
        d.line(seg, fill=color, width=arc_w, joint="curve")

    # Endpoint dots — only draw if endpoint is on the visible hemisphere.
    def is_front(lon, lat):
        lon_r = math.radians(lon); lat_r = math.radians(lat)
        return math.cos(lat_r) * math.cos(lon_r) >= -0.02  # +x axis is front

    dot_r = max(3, int(W * 0.022))
    for lon, lat, on in ((lon1, lat1, is_front(lon1, lat1)),
                         (lon2, lat2, is_front(lon2, lat2))):
        if not on:
            continue
        lon_r = math.radians(lon); lat_r = math.radians(lat)
        y = math.cos(lat_r) * math.sin(lon_r)
        z = math.sin(lat_r)
        px = cx + y * r; py = cy - z * r
        # Halo
        halo = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(halo).ellipse(
            (px - dot_r * 2.2, py - dot_r * 2.2, px + dot_r * 2.2, py + dot_r * 2.2),
            fill=glow_color,
        )
        halo = halo.filter(ImageFilter.GaussianBlur(radius=W * 0.01))
        canvas.alpha_composite(halo)
        ImageDraw.Draw(canvas).ellipse(
            (px - dot_r, py - dot_r, px + dot_r, py + dot_r),
            fill=color,
        )


def build_icon() -> Image.Image:
    # Dark rounded-square background (rounded ~22% like iOS).
    bg = rounded_square(W, int(W * 0.22), BG)

    canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    canvas.alpha_composite(bg)

    draw_globe(canvas)

    # Two crossing great-circle arcs, chosen so they obviously cross near
    # the center of the visible disk and endpoints sit symmetrically.
    # Convention: lon=0 is dead center; +lon = right, +lat = up.
    # Green arc: upper-left ↘ lower-right
    draw_arc(
        canvas,
        lon1=-50, lat1=38,
        lon2=50, lat2=-38,
        color=GREEN,
        glow_color=(GREEN[0], GREEN[1], GREEN[2], 210),
    )
    # Red arc: lower-left ↗ upper-right (mirror tilt)
    draw_arc(
        canvas,
        lon1=-50, lat1=-38,
        lon2=50, lat2=38,
        color=RED,
        glow_color=(RED[0], RED[1], RED[2], 210),
    )

    # Downsample for crisp antialiasing.
    final = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    return final


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
