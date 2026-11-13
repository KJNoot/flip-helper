#!/usr/bin/env python3
"""Draw original, unbranded sample photos and the intro poster. No real brands."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance
import math, random

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "app" / "media"
SAMPLES = MEDIA / "samples"
SCRIPT = ROOT / "app" / "fonts" / "DancingScript-Jessika.ttf"
INTER = Path("/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf")

def font(path, size, weight=None):
    f = ImageFont.truetype(str(path), size=size)
    if weight is not None:
        try:
            f.set_variation_by_axes({"wght": weight})
        except Exception:
            pass
    return f

def grad(size, c1, c2, vertical=True):
    w, h = size
    im = Image.new("RGB", size, c1)
    px = im.load()
    for i in range(h if vertical else w):
        t = i / max(1, (h if vertical else w) - 1)
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        if vertical:
            for x in range(w):
                px[x, i] = (r, g, b)
        else:
            for y in range(h):
                px[i, y] = (r, g, b)
    return im

def ellipse(draw, box, fill, outline=None, width=1):
    draw.ellipse(box, fill=fill, outline=outline, width=width)

def shadow_ellipse(base, box, blur=18, alpha=70, color=(18, 49, 46)):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse(box, fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(base.convert("RGBA"), layer)

def save_jpg(im, path, quality=88):
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb = im.convert("RGB")
    rgb = ImageEnhance.Contrast(rgb).enhance(1.04)
    rgb.save(path, "JPEG", quality=quality, optimize=True, subsampling=0)
    print(f"  {path.name} {path.stat().st_size} bytes {rgb.size}")

def draw_mug():
    W = H = 900
    im = grad((W, H), (232, 241, 236), (247, 242, 232))
    # soft vignette
    vig = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vig)
    vd.ellipse((-80, -80, W + 80, H + 80), outline=(15, 70, 66, 18), width=160)
    vig = vig.filter(ImageFilter.GaussianBlur(40))
    im = Image.alpha_composite(im.convert("RGBA"), vig)

    # shadow
    im = shadow_ellipse(im, (250, 680, 660, 790), blur=24, alpha=60)

    d = ImageDraw.Draw(im, "RGBA")
    # handle (behind-ish right)
    # outer handle
    d.arc((560, 330, 750, 620), start=300, end=80, fill=(214, 198, 172, 255), width=52)
    d.arc((560, 330, 750, 620), start=300, end=80, fill=(196, 176, 148, 255), width=18)
    # inner hole suggestion
    d.arc((590, 365, 720, 585), start=305, end=75, fill=(232, 241, 236, 200), width=10)

    # body
    body = (280, 300, 640, 730)
    # side
    d.rounded_rectangle(body, radius=90, fill=(236, 223, 200, 255))
    # slightly darker right edge for volume
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    sd.pieslice((400, 300, 680, 730), 270, 90, fill=(120, 90, 60, 28))
    shade = shade.filter(ImageFilter.GaussianBlur(16))
    im = Image.alpha_composite(im, shade)
    d = ImageDraw.Draw(im, "RGBA")

    # rim
    d.ellipse((280, 250, 640, 390), fill=(210, 192, 164, 255))
    d.ellipse((310, 270, 610, 365), fill=(118, 90, 68, 255))  # interior
    d.ellipse((330, 285, 590, 350), fill=(92, 68, 50, 255))
    # highlight on rim
    d.arc((300, 258, 620, 385), 200, 350, fill=(255, 250, 240, 180), width=6)

    # speckles
    rng = random.Random(7)
    for _ in range(160):
        x = rng.randint(300, 620)
        y = rng.randint(400, 700)
        # stay inside body roughly
        if y < 370:
            continue
        r = rng.choice([1, 1, 2, 2, 3])
        col = rng.choice([
            (120, 90, 64, 140),
            (90, 68, 48, 120),
            (150, 118, 88, 100),
            (70, 52, 38, 90),
        ])
        d.ellipse((x - r, y - r, x + r, y + r), fill=col)

    # bottom ellipse
    d.ellipse((320, 680, 600, 750), fill=(200, 180, 150, 255))
    d.ellipse((350, 700, 570, 742), fill=(180, 158, 128, 200))

    # soft highlight on left body
    hl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.ellipse((310, 410, 430, 620), fill=(255, 252, 245, 55))
    hl = hl.filter(ImageFilter.GaussianBlur(12))
    im = Image.alpha_composite(im, hl)
    return im.convert("RGB")

def draw_frame():
    W = H = 900
    im = grad((W, H), (236, 232, 222), (214, 222, 216))
    im = shadow_ellipse(im, (200, 760, 700, 850), blur=22, alpha=55)
    d = ImageDraw.Draw(im, "RGBA")

    # outer wood
    wood = (150, 110, 750, 790)
    d.rounded_rectangle(wood, radius=8, fill=(150, 102, 58, 255))
    # wood grain lines
    rng = random.Random(11)
    for i in range(18):
        y = 120 + i * 38
        col = (130 + rng.randint(-10, 16), 86 + rng.randint(-8, 10), 48 + rng.randint(-6, 8), 50)
        d.line((160, y, 740, y + rng.randint(-4, 4)), fill=col, width=2)
    # inner gold lip
    d.rectangle((198, 158, 702, 742), fill=(196, 158, 90, 255))
    # mat
    d.rectangle((214, 174, 686, 726), fill=(245, 239, 226, 255))
    # art: simple original rolling hills and sun — not a known painting
    art = (250, 210, 650, 690)
    d.rectangle(art, fill=(186, 216, 224, 255))
    # sun
    d.ellipse((470, 250, 560, 340), fill=(244, 201, 93, 255))
    # hills
    d.polygon([(250, 520), (330, 430), (430, 500), (520, 400), (650, 510), (650, 690), (250, 690)], fill=(90, 140, 108, 255))
    d.polygon([(250, 590), (380, 500), (500, 580), (650, 530), (650, 690), (250, 690)], fill=(62, 112, 88, 255))
    # foreground meadow
    d.polygon([(250, 650), (450, 610), (650, 640), (650, 690), (250, 690)], fill=(120, 158, 90, 255))
    # inner shadow of frame
    d.rectangle((250, 210, 650, 690), outline=(80, 54, 30, 80), width=3)
    # highlight on top wood
    d.rectangle((160, 118, 740, 132), fill=(190, 140, 88, 90))
    return im.convert("RGB")

def draw_tote():
    W = H = 900
    im = grad((W, H), (245, 239, 230), (222, 228, 230))
    im = shadow_ellipse(im, (230, 730, 680, 830), blur=26, alpha=60)
    d = ImageDraw.Draw(im, "RGBA")
    navy = (28, 49, 84, 255)
    navy2 = (22, 38, 68, 255)
    navy_l = (48, 72, 112, 255)

    # handles (behind)
    d.arc((280, 140, 450, 420), 200, 340, fill=navy, width=28)
    d.arc((460, 140, 630, 420), 200, 340, fill=navy, width=28)
    # handle highlights
    d.arc((280, 140, 450, 420), 230, 310, fill=(90, 120, 160, 160), width=6)

    # bag body - trapezoid
    body = [(230, 340), (670, 340), (630, 760), (270, 760)]
    d.polygon(body, fill=navy)
    # right shade
    d.polygon([(560, 340), (670, 340), (630, 760), (560, 760)], fill=navy2)
    # top opening
    d.ellipse((230, 310, 670, 385), fill=navy_l)
    d.ellipse((260, 322, 640, 372), fill=(18, 30, 54, 255))
    # front pocket stitch
    d.rounded_rectangle((330, 470, 570, 680), radius=10, outline=(90, 120, 160, 180), width=3)
    d.line((330, 510, 570, 510), fill=(90, 120, 160, 150), width=2)
    # top seam
    d.arc((250, 360, 650, 430), 10, 170, fill=(90, 120, 160, 120), width=2)
    # canvas texture dots
    rng = random.Random(21)
    for _ in range(80):
        x = rng.randint(280, 620)
        y = rng.randint(400, 730)
        d.point((x, y), fill=(40, 62, 100, 80))
    # left highlight
    hl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.polygon([(270, 380), (340, 380), (330, 740), (280, 740)], fill=(255, 255, 255, 22))
    hl = hl.filter(ImageFilter.GaussianBlur(8))
    im = Image.alpha_composite(im.convert("RGBA"), hl)
    return im.convert("RGB")

def draw_icon(draw, cx, cy, s=64):
    # rounded square + cycle arrows, matching the app mark
    r = s * 0.28
    box = [cx - s/2, cy - s/2, cx + s/2, cy + s/2]
    draw.rounded_rectangle(box, radius=r, fill=(15, 118, 110, 255))
    # simple cycle
    t = s * 0.22
    draw.arc((cx - t*1.4, cy - t*1.4, cx + t*1.4, cy + t*1.4), 200, 70, fill=(255, 255, 255, 255), width=max(3, int(s*0.08)))
    draw.arc((cx - t*1.4, cy - t*1.4, cx + t*1.4, cy + t*1.4), 20, 250, fill=(94, 234, 212, 255), width=max(3, int(s*0.08)))

def draw_poster():
    W, H = 720, 1280
    im = grad((W, H), (15, 118, 110), (13, 62, 64))
    d = ImageDraw.Draw(im, "RGBA")
    # decorative circles like the end card
    d.ellipse((400, -160, 980, 420), fill=(20, 150, 140, 50))
    d.ellipse((-300, 900, 420, 1620), fill=(10, 80, 76, 70))
    # icon
    # white rounded tile
    cx, cy = W // 2, 430
    d.rounded_rectangle((cx - 64, cy - 64, cx + 64, cy + 64), radius=28, fill=(255, 255, 255, 255))
    # teal mark arrows
    # top arc + arrow
    d.arc((cx - 36, cy - 36, cx + 36, cy + 36), 210, 40, fill=(15, 118, 110, 255), width=8)
    d.polygon([(cx + 28, cy - 34), (cx + 46, cy - 18), (cx + 18, cy - 16)], fill=(15, 118, 110, 255))
    d.arc((cx - 36, cy - 36, cx + 36, cy + 36), 30, 220, fill=(45, 180, 168, 255), width=8)
    d.polygon([(cx - 28, cy + 34), (cx - 46, cy + 18), (cx - 18, cy + 16)], fill=(45, 180, 168, 255))

    script = font(SCRIPT, 92, 600)
    bold = font(INTER, 52, 800)
    sub = font(INTER, 28, 550)
    coming = font(INTER, 34, 650)

    def center(text, y, f, fill=(255, 255, 255, 255)):
        bb = d.textbbox((0, 0), text, font=f)
        tw = bb[2] - bb[0]
        d.text(((W - tw) / 2, y), text, font=f, fill=fill)

    center("Jessika’s", 530, script, (255, 255, 255, 255))
    center("Flip Side", 630, bold, (255, 255, 255, 255))
    # thin rule
    d.rectangle((W/2 - 28, 710, W/2 + 28, 714), fill=(94, 234, 212, 220))
    center("Video coming soon", 760, coming, (255, 255, 255, 230))
    center("A short look at how it works,", 860, sub, (200, 230, 226, 220))
    center("from a photo all the way to shipping.", 900, sub, (200, 230, 226, 220))
    # play hint
    d.ellipse((W/2 - 42, 1020, W/2 + 42, 1104), fill=(255, 255, 255, 28), outline=(255, 255, 255, 80), width=2)
    d.polygon([(W/2 - 12, 1042), (W/2 - 12, 1082), (W/2 + 26, 1062)], fill=(255, 255, 255, 230))
    return im.convert("RGB")

def main():
    SAMPLES.mkdir(parents=True, exist_ok=True)
    save_jpg(draw_mug(), SAMPLES / "mug.jpg", 90)
    save_jpg(draw_frame(), SAMPLES / "frame.jpg", 90)
    save_jpg(draw_tote(), SAMPLES / "tote.jpg", 90)
    save_jpg(draw_poster(), MEDIA / "intro-poster.jpg", 88)
    print("done")

if __name__ == "__main__":
    main()
