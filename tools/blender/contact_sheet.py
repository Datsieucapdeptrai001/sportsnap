"""Compose original model renders with the existing backend Pillow dependency."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--previews', type=Path, required=True)
    args = parser.parse_args()
    models = json.loads(args.manifest.read_text(encoding='utf-8'))['models']
    # A real 200 px-wide render tile makes thumbnail recognition review repeatable.
    width, height, columns = 220, 220, 5
    sheet = Image.new('RGB', (columns*width, max(1, (len(models)+columns-1)//columns)*height), '#e8eef4')
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=13)
    small = ImageFont.load_default(size=11)
    for index, (label, entry) in enumerate(models.items()):
        x, y = index % columns*width, index//columns*height
        path = args.previews/f'{Path(entry["file"]).stem}.png'
        if path.is_file():
            with Image.open(path) as source:
                tile = ImageOps.contain(source.convert('RGB'), (200, 163))
                sheet.paste(tile, (x+(width-tile.width)//2, y+4))
        else:
            draw.text((x+12, y+100), 'Preview missing', fill='#a11', font=font)
        draw.text((x+10, y+176), label, fill='#13253c', font=font)
        draw.text((x+10, y+198), f'{entry["triangles"]:,} tris | {entry["bytes"]:,} bytes',
                  fill='#42566e', font=small)
    # Replace atomically: desktop previewers may keep the previous PNG mapped.
    pending = args.previews/'contact_sheet.pending.png'
    sheet.save(pending)
    pending.replace(args.previews/'contact_sheet.png')
    print(args.previews/'contact_sheet.png')


if __name__ == '__main__':
    main()
