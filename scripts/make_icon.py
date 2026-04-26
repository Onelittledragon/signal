"""Generate cartoon-style globe icons for SIGNAL.

Design: dark #0a0a0a rounded-square background with a cartoon-style Earth.
Sphere is a soft dark-gray gradient (light at top-left, darker at bottom-right
for a hand-drawn 3D feel). Continents are filled in light gray (Africa,
Europe, the Americas, etc.) using hand-tuned polygon silhouettes. A small red
pin and a small green pin sit on land masses for accent.

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

# Palette
BG = (10, 10, 10, 255)              # #0a0a0a
SPHERE_LIGHT = (74, 78, 86, 255)    # top-left highlight on the sphere
SPHERE_DARK = (32, 34, 39, 255)     # bottom-right shadow on the sphere
LAND = (210, 214, 222, 255)         # light gray continents
LAND_EDGE = (160, 165, 174, 255)    # subtle outline
GRID = (96, 102, 112, 110)          # very soft equator/meridian
RED = (241, 74, 62, 255)            # accent pin
GREEN = (48, 211, 122, 255)         # accent pin

# Render at 4x then downsample for clean antialiasing.
SCALE = 4
W = SIZE * SCALE
CX = W // 2
CY = W // 2
R = int(W * 0.34)


# ---------------------------------------------------------------------------
# Projection — orthographic, camera on +x axis. lon=0,lat=0 sits dead center.
# ---------------------------------------------------------------------------

def to_xyz(lon: float, lat: float) -> tuple[float, float, float]:
    lo = math.radians(lon)
    la = math.radians(lat)
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def project_pt(lon: float, lat: float) -> tuple[float, float] | None:
    x, y, z = to_xyz(lon, lat)
    if x < -0.02:
        return None
    return (CX + y * R, CY - z * R)


def project_poly(coords: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for lon, lat in coords:
        p = project_pt(lon, lat)
        if p is not None:
            out.append(p)
    return out


# ---------------------------------------------------------------------------
# Continent silhouettes — hand-drawn lat/lon polygons. Simplified for the
# cartoon look. Front hemisphere is roughly lon ∈ [-90, 90].
# ---------------------------------------------------------------------------

AFRICA = [
    (-17, 14), (-15, 21), (-10, 27), (-2, 35), (10, 36), (20, 32),
    (32, 31), (43, 12), (51, 11), (45, 0), (40, -10), (35, -20),
    (32, -28), (25, -33), (18, -34), (10, -22), (5, -10), (0, 0),
    (-8, 4), (-13, 8), (-17, 14),
]

EUROPE = [
    (-10, 36), (-5, 43), (0, 44), (5, 50), (10, 54), (20, 55),
    (30, 60), (40, 62), (45, 55), (40, 48), (28, 45), (20, 42),
    (12, 45), (5, 43), (-5, 36), (-10, 36),
]

ASIA_WEST = [
    (28, 45), (40, 48), (50, 45), (60, 50), (75, 50), (88, 48),
    (88, 35), (78, 25), (60, 22), (50, 26), (45, 30), (40, 38), (28, 45),
]

ARABIA = [
    (35, 28), (45, 25), (55, 20), (52, 12), (48, 12),
    (43, 12), (35, 18), (32, 25), (35, 28),
]

# A small slice of South America peeking on the western limb.
S_AMERICA = [
    (-72, 8), (-68, 5), (-60, 0), (-50, -10), (-45, -22),
    (-58, -33), (-70, -38), (-74, -30), (-78, -10), (-78, 5), (-72, 8),
]

# A small slice of North America (the eastern coast) on the western limb.
N_AMERICA = [
    (-80, 32), (-72, 40), (-66, 45), (-60, 48), (-58, 55),
    (-66, 58), (-78, 56), (-82, 48), (-82, 38), (-80, 32),
]

# Madagascar — small off-coast detail.
MADAGASCAR = [
    (43, -15), (47, -16), (49, -22), (47, -25), (44, -23), (43, -15),
]

CONTINENTS = [
    ("AFRICA", AFRICA),
    ("EUROPE", EUROPE),
    ("ASIA_WEST", ASIA_WEST),
    ("ARABIA", ARABIA),
    ("S_AMERICA", S_AMERICA),
    ("N_AMERICA", N_AMERICA),
    ("MADAGASCAR", MADAGASCAR),
]


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

def rounded_square(size: int, radius: int, fill) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return img


def draw_sphere_gradient(canvas: Image.Image) -> None:
    """Soft radial gradient for the sphere body — lighter at upper-left,
    darker toward lower-right, giving a cartoon 3D feel."""
    diam = R * 2
    grad = Image.new("RGBA", (diam, diam), (0, 0, 0, 0))
    px = grad.load()
    # Light source in upper-left of the disk.
    lx, ly = diam * 0.32, diam * 0.32
    max_d = math.hypot(diam, diam)
    for j in range(diam):
        for i in range(diam):
            dx = i - diam / 2
            dy = j - diam / 2
            if dx * dx + dy * dy > (diam / 2) ** 2:
                continue
            d = math.hypot(i - lx, j - ly) / max_d
            t = max(0.0, min(1.0, d * 1.7))
            r = int(SPHERE_LIGHT[0] * (1 - t) + SPHERE_DARK[0] * t)
            g = int(SPHERE_LIGHT[1] * (1 - t) + SPHERE_DARK[1] * t)
            b = int(SPHERE_LIGHT[2] * (1 - t) + SPHERE_DARK[2] * t)
            px[i, j] = (r, g, b, 255)
    canvas.alpha_composite(grad, (CX - R, CY - R))


def draw_grid(canvas: Image.Image) -> None:
    d = ImageDraw.Draw(canvas)
    line_w = max(1, int(W * 0.005))
    # Equator
    d.ellipse(
        (CX - R, CY - int(R * 0.13), CX + R, CY + int(R * 0.13)),
        outline=GRID,
        width=line_w,
    )
    # Two meridians
    for tilt in (0.42, 0.78):
        d.ellipse(
            (CX - int(R * tilt), CY - R, CX + int(R * tilt), CY + R),
            outline=GRID,
            width=line_w,
        )


def draw_continents(canvas: Image.Image) -> None:
    # Densify polygon edges so projection clipping is smoother on the limb.
    def densify(coords, step_deg=2.5):
        out = []
        for i in range(len(coords) - 1):
            a = coords[i]
            b = coords[i + 1]
            dx = b[0] - a[0]
            dy = b[1] - a[1]
            dist = math.hypot(dx, dy)
            n = max(1, int(dist / step_deg))
            for k in range(n):
                t = k / n
                out.append((a[0] + dx * t, a[1] + dy * t))
        out.append(coords[-1])
        return out

    # Land must be clipped to the sphere disk so it never spills past the limb.
    sphere_mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(sphere_mask).ellipse((CX - R, CY - R, CX + R, CY + R), fill=255)

    land_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(land_layer)
    edge_w = max(1, int(W * 0.004))

    for _name, poly in CONTINENTS:
        screen = project_poly(densify(poly))
        if len(screen) >= 3:
            ld.polygon(screen, fill=LAND, outline=LAND_EDGE)
            # Slightly thicker outline for readability at small sizes.
            ld.line(screen + [screen[0]], fill=LAND_EDGE, width=edge_w, joint="curve")

    # Apply sphere clip.
    clipped = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    clipped.paste(land_layer, (0, 0), sphere_mask)
    canvas.alpha_composite(clipped)


def draw_specular(canvas: Image.Image) -> None:
    """Small soft white highlight in the upper-left quadrant of the sphere
    for that classic cartoon shine."""
    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    hx = CX - int(R * 0.42)
    hy = CY - int(R * 0.45)
    rr = int(R * 0.22)
    gd.ellipse((hx - rr, hy - rr, hx + rr, hy + rr), fill=(255, 255, 255, 55))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=W * 0.025))

    # Clip to sphere.
    sphere_mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(sphere_mask).ellipse((CX - R, CY - R, CX + R, CY + R), fill=255)
    clipped = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    clipped.paste(glow, (0, 0), sphere_mask)
    canvas.alpha_composite(clipped)


def draw_limb(canvas: Image.Image) -> None:
    """Crisp dark outer ring so the sphere reads as a defined disk."""
    d = ImageDraw.Draw(canvas)
    w = max(2, int(W * 0.012))
    d.ellipse((CX - R, CY - R, CX + R, CY + R), outline=(20, 22, 26, 255), width=w)


def draw_pin(canvas: Image.Image, lon: float, lat: float, color, glow_color) -> None:
    p = project_pt(lon, lat)
    if p is None:
        return
    px, py = p
    halo = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    hr = max(6, int(W * 0.030))
    ImageDraw.Draw(halo).ellipse((px - hr, py - hr, px + hr, py + hr), fill=glow_color)
    halo = halo.filter(ImageFilter.GaussianBlur(radius=W * 0.012))
    canvas.alpha_composite(halo)
    dot_r = max(3, int(W * 0.018))
    ImageDraw.Draw(canvas).ellipse(
        (px - dot_r, py - dot_r, px + dot_r, py + dot_r),
        fill=color,
        outline=(20, 22, 26, 255),
        width=max(1, int(W * 0.003)),
    )


def build_icon() -> Image.Image:
    canvas = rounded_square(W, int(W * 0.22), BG)

    draw_sphere_gradient(canvas)
    draw_grid(canvas)
    draw_continents(canvas)
    draw_specular(canvas)
    draw_limb(canvas)

    # Two small accent pins — one green over Europe, one red over Arabia/Mid East.
    draw_pin(canvas, lon=10, lat=50, color=GREEN, glow_color=(GREEN[0], GREEN[1], GREEN[2], 200))
    draw_pin(canvas, lon=44, lat=24, color=RED, glow_color=(RED[0], RED[1], RED[2], 200))

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
