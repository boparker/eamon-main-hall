#!/usr/bin/env python3
"""crop-bars.py — detect and remove letterbox bars flux sometimes bakes into
wide shots. A row is a "bar" if its mean luminance is near-black AND its
variance is tiny (real dark art has texture; bars are flat). Crops top and
bottom independently, only if bars are found.

usage: python3 tools/crop-bars.py <src.png> [dst.png]   (dst defaults to src)
exits 0 always; prints "cropped N+M <file>" or "clean <file>".
"""
import sys
from PIL import Image, ImageStat

def bar_rows(img, from_top=True, max_frac=0.12):
    w, h = img.size
    limit = int(h * max_frac)
    gray = img.convert('L')
    n = 0
    for i in range(limit):
        y = i if from_top else h - 1 - i
        row = gray.crop((0, y, w, y + 1))
        stat = ImageStat.Stat(row)
        if stat.mean[0] < 14 and stat.stddev[0] < 6:
            n += 1
        else:
            break
    return n

def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    img = Image.open(src)
    w, h = img.size
    top = bar_rows(img, True)
    bottom = bar_rows(img, False)
    if top + bottom == 0:
        print(f'clean {src}')
        if dst != src:
            img.save(dst)
        return
    # A few extra pixels past the bar edge removes the soft transition line.
    pad = 4
    box = (0, min(top + pad, h // 4), w, h - min(bottom + pad, h // 4))
    img.crop(box).save(dst)
    print(f'cropped {top}+{bottom} {src}')

if __name__ == '__main__':
    main()
