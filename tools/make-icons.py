# Draws the app icons (no outside artwork). Run: python3 tools/make-icons.py
from PIL import Image, ImageDraw, ImageFont
import os, math

OUT = os.path.join(os.path.dirname(__file__), "..", "app", "icons")
os.makedirs(OUT, exist_ok=True)
A, B = (15, 118, 110), (45, 212, 191)

def gradient(S):
    im = Image.new("RGB", (S, S))
    px = im.load()
    for y in range(S):
        for x in range(S):
            t = (x * 0.55 + y * 0.45) / S
            r = math.hypot(x - S * 0.75, y - S * 0.2) / S
            t = min(1, max(0, t * 0.85 + (1 - r) * 0.15))
            px[x, y] = tuple(int(A[i] + (B[i] - A[i]) * t) for i in range(3))
    return im

def art(size, pad_frac):
    S = 1024
    im = gradient(S).convert("RGBA")
    k = (S - 2 * pad_frac * S) / 1024
    cx, cy = S / 2, S / 2 + 10 * k
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    tw, th = 640 * k, 420 * k
    x0, y0 = cx - tw / 2, cy - th / 2
    x1, y1 = cx + tw / 2, cy + th / 2
    r = 70 * k
    mid_y = (y0 + y1) / 2
    ld.rounded_rectangle([x0 + 80 * k, y0, x1, y1], radius=r, fill=(255, 255, 255, 255))
    ld.polygon([(x0 + 90 * k, y0), (x0 - 40 * k, mid_y), (x0 + 90 * k, y1)], fill=(255, 255, 255, 255))
    hole_r = 52 * k
    hx = x0 + 70 * k
    ld.ellipse([hx - hole_r, mid_y - hole_r, hx + hole_r, mid_y + hole_r], fill=(13, 90, 85, 255))
    font = None
    for fp in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, int(280 * k))
                break
            except Exception:
                pass
    if font:
        bbox = ld.textbbox((0, 0), "$", font=font)
        tw2, th2 = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = cx + 40 * k - tw2 / 2
        ty = mid_y - th2 / 2 - bbox[1] - 8 * k
        ld.text((tx, ty), "$", font=font, fill=(15, 118, 110, 255))
    layer = layer.rotate(28, resample=Image.Resampling.BICUBIC, center=(cx, cy))
    im = Image.alpha_composite(im, layer)
    return im.convert("RGB").resize((size, size), Image.Resampling.LANCZOS)

art(192, 0.0).save(os.path.join(OUT, "icon-192.png"))
art(512, 0.0).save(os.path.join(OUT, "icon-512.png"))
art(512, 0.12).save(os.path.join(OUT, "maskable-512.png"))
art(180, 0.0).save(os.path.join(OUT, "apple-touch-icon.png"))
art(32, 0.0).save(os.path.join(OUT, "favicon-32.png"))
art(1024, 0.0).save(os.path.join(OUT, "icon-1024.png"))
print("icons written")
