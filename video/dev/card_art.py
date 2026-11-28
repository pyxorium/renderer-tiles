"""The card pictures for "Videos" (the video renderer): banner.png (1280 x 720) and icon.png (256 x 256), written into
video\\tile\\. Drawn with Pillow, no footage (the renderer plays anyone's video): a dark screen with a play button and
the progress bar made of seconds, some lit green (checked), one amber (arriving), as the tile shows them.
Run in C:\\thunderbird-cafe\\renderer-tiles:  python video\\dev\\card_art.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / 'tile'
FONTS = ['segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']
FONTS_R = ['segoeui.ttf', 'arial.ttf', 'DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']


def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            pass
    return ImageFont.load_default(size)


def backdrop(w, h):
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            # a dusk-like wash: deep blue at the top to violet-black below
            t = y / h
            r = int(20 + 40 * t * (x / w))
            g = int(24 + 6 * (1 - t))
            b = int(52 - 28 * t + 30 * (1 - x / w) * (1 - t))
            px[x, y] = (r, g, b)
    return img


def seconds(d, x0, y0, width, height, n, lit, arriving, gap):
    cell = (width - gap * (n - 1)) / n
    for i in range(n):
        x = x0 + i * (cell + gap)
        colour = (63, 185, 80) if i < lit else (210, 153, 34) if i < lit + arriving else (70, 70, 80)
        d.rectangle([round(x), y0, round(x + cell) - 1, y0 + height], fill=colour)


def play_button(d, cx, cy, r, line):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(0, 0, 0), outline=(235, 235, 235), width=line)
    s = r * 0.5
    d.polygon([(cx - s * 0.7, cy - s), (cx - s * 0.7, cy + s), (cx + s, cy)], fill=(245, 245, 245))


def banner():
    w, h = 1280, 720
    img = backdrop(w, h)
    d = ImageDraw.Draw(img)
    play_button(d, w // 2, 300, 92, 5)
    seconds(d, 90, 560, w - 180, 18, 40, 15, 2, 4)
    d.ellipse([90 + (w - 180) * 13 / 40 - 14, 555, 90 + (w - 180) * 13 / 40 + 14, 583], fill=(255, 255, 255))
    d.text((90, 64), 'Videos', font=font(FONTS, 72), fill=(255, 255, 255))
    d.text((92, 152), 'Video from people\'s own accounts, a second at a time', font=font(FONTS_R, 34), fill=(225, 225, 235))
    d.text((90, 610), 'Each piece checked against its address as it arrives  ·  or just the sound', font=font(FONTS_R, 28), fill=(200, 200, 215))
    img.save(OUT / 'banner.png', optimize=True)


def icon():
    s = 256
    img = backdrop(s, s)
    d = ImageDraw.Draw(img)
    play_button(d, s // 2, 108, 58, 4)
    seconds(d, 26, 200, s - 52, 14, 10, 5, 1, 3)
    img.save(OUT / 'icon.png', optimize=True)


if __name__ == '__main__':
    banner()
    icon()
    print(f'Wrote {OUT / "banner.png"} and {OUT / "icon.png"}')
