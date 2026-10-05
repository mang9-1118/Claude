#!/usr/bin/env python3
"""Tile rendered frames into a labelled contact sheet.

usage: contact_sheet.py OUT.png IMG [IMG ...] [--cols N] [--width W]
"""
import sys
from PIL import Image, ImageDraw, ImageFont


def main():
    args = sys.argv[1:]
    cols, width = 4, 480
    if '--cols' in args:
        i = args.index('--cols'); cols = int(args[i + 1]); del args[i:i + 2]
    if '--width' in args:
        i = args.index('--width'); width = int(args[i + 1]); del args[i:i + 2]
    out, files = args[0], args[1:]
    h = round(width * 9 / 16)
    rows = (len(files) + cols - 1) // cols
    pad, label = 6, 22
    sheet = Image.new('RGB', (cols * (width + pad) + pad, rows * (h + pad + label) + pad), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 14)
    except OSError:
        font = ImageFont.load_default()
    for k, f in enumerate(files):
        im = Image.open(f).convert('RGB').resize((width, h), Image.LANCZOS)
        x = pad + (k % cols) * (width + pad)
        y = pad + (k // cols) * (h + pad + label)
        sheet.paste(im, (x, y + label))
        name = f.rsplit('/', 1)[-1].rsplit('.', 1)[0]
        draw.text((x + 2, y + 3), name, fill=(220, 220, 220), font=font)
    sheet.save(out)


if __name__ == '__main__':
    main()
