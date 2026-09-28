#!/usr/bin/env python3
"""Draw pantry-tracker PWA icons with the Python standard library."""

import struct
import zlib
from pathlib import Path

BG = (29, 92, 66, 255)
WHITE = (255, 253, 248, 255)
AMBER = (224, 122, 61, 255)
INK = (29, 92, 66, 255)


def set_px(buf, size, x, y, color):
    if 0 <= x < size and 0 <= y < size:
        buf[y][x] = color


def fill_rect(buf, size, x0, y0, x1, y1, color):
    for y in range(y0, y1):
        for x in range(x0, x1):
            set_px(buf, size, x, y, color)


def fill_circle(buf, size, cx, cy, r, color):
    r2 = r * r
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                set_px(buf, size, x, y, color)


def round_rect(buf, size, x0, y0, x1, y1, radius, color):
    fill_rect(buf, size, x0 + radius, y0, x1 - radius, y1, color)
    fill_rect(buf, size, x0, y0 + radius, x1, y1 - radius, color)
    fill_circle(buf, size, x0 + radius, y0 + radius, radius, color)
    fill_circle(buf, size, x1 - radius - 1, y0 + radius, radius, color)
    fill_circle(buf, size, x0 + radius, y1 - radius - 1, radius, color)
    fill_circle(buf, size, x1 - radius - 1, y1 - radius - 1, radius, color)


def draw(size, maskable=False):
    buf = [[BG for _ in range(size)] for _ in range(size)]
    pad = int(size * (0.22 if maskable else 0.14))
    left = pad
    top = int(size * (0.26 if maskable else 0.22))
    right = size - pad
    bottom = size - int(size * (0.22 if maskable else 0.16))
    radius = max(4, int(size * 0.06))
    round_rect(buf, size, left, top, right, bottom, radius, WHITE)

    mid = (left + right) // 2
    stroke = max(2, size // 64)
    fill_rect(buf, size, mid - stroke // 2, top + radius, mid + stroke // 2 + 1, bottom - radius, INK)

    knob_r = max(2, size // 48)
    knob_y = (top + bottom) // 2
    fill_circle(buf, size, mid - int(size * 0.08), knob_y, knob_r, INK)
    fill_circle(buf, size, mid + int(size * 0.08), knob_y, knob_r, INK)

    badge_r = max(6, int(size * 0.075))
    fill_circle(buf, size, right - badge_r, top + badge_r // 2, badge_r, AMBER)
    return buf


def write_png(path, buf):
    size = len(buf)
    raw = bytearray()
    for row in buf:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend((r, g, b, a))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    out = Path(__file__).resolve().parents[1] / "public" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    write_png(out / "icon-192.png", draw(192))
    write_png(out / "icon-512.png", draw(512))
    write_png(out / "icon-maskable-512.png", draw(512, maskable=True))
    write_png(out / "apple-touch-icon.png", draw(180))
    print(f"wrote icons to {out}")


if __name__ == "__main__":
    main()
