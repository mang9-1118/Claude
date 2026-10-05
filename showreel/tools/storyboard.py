#!/usr/bin/env python3
"""Build the README storyboard: one key frame per section, labelled.

usage: storyboard.py FRAMES_DIR OUT.jpg
"""
import sys
from PIL import Image, ImageDraw, ImageFont

BEAT_FRAMES = 60 * 60 / 128  # frames per beat
PICKS = [
    (2.3, '00  COUNTDOWN'),
    (7.3, '01  KINETIC TYPE'),
    (9.25, '02  SHAPE & RHYTHM'),
    (13.3, '03  PARTICLE SYSTEMS'),
    (18.6, '04  PROCEDURAL 3D'),
    (22.3, '05  SHADERS & FLUIDS'),
    (26.0, '06  DATA & INTERFACE'),
    (31.5, '07  IDENT'),
]


def main():
    src, out = sys.argv[1], sys.argv[2]
    cols, w = 4, 480
    h = w * 9 // 16
    pad, lab = 10, 30
    rows = (len(PICKS) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (w + pad) + pad, rows * (h + lab + pad) + pad), (14, 14, 18))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 13)
    except OSError:
        font = ImageFont.load_default()
    for k, (beat, label) in enumerate(PICKS):
        f = round(beat * BEAT_FRAMES)
        im = Image.open(f'{src}/f_{f:04d}.png').convert('RGB').resize((w, h), Image.LANCZOS)
        x = pad + (k % cols) * (w + pad)
        y = pad + (k // cols) * (h + lab + pad)
        sheet.paste(im, (x, y))
        d.rectangle([x, y + h + 9, x + 8, y + h + 17], fill=(255, 91, 31))
        d.text((x + 16, y + h + 6), label, fill=(232, 228, 220), font=font)
    sheet.save(out, quality=88, optimize=True, progressive=True)


if __name__ == '__main__':
    main()
