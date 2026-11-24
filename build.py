import json
import os
import shutil
import struct
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist"


def make_png(size: int) -> bytes:
    """Generate a crisp RGBA PNG icon of the given size with an X-blue badge and white '文' / spark glyph."""
    w = h = size
    rows = []
    cx = (w - 1) / 2.0
    cy = (h - 1) / 2.0
    radius = w * 0.46

    for y in range(h):
        row = bytearray([0])  # filter type 0
        for x in range(w):
            dx = abs(x - cx)
            dy = abs(y - cy)
            # Rounded square distance
            corner = max(dx - (radius - w * 0.18), 0.0) ** 2 + max(dy - (radius - w * 0.18), 0.0) ** 2
            in_badge = (dx <= radius and dy <= radius) and (
                dx <= radius - w * 0.18 or dy <= radius - w * 0.18 or corner <= (w * 0.18) ** 2
            )

            if not in_badge:
                row.extend((0, 0, 0, 0))
                continue

            # Subtle vertical gradient in X-blue (#1d9bf0 -> #0d74c4)
            t = y / max(1, h - 1)
            r = int(29 * (1 - t) + 13 * t)
            g = int(155 * (1 - t) + 116 * t)
            b = int(240 * (1 - t) + 196 * t)

            # Draw a clean stylized 'X' / translate cross in the center
            nx = (x - cx) / max(1.0, w * 0.28)
            ny = (y - cy) / max(1.0, h * 0.28)
            on_diag1 = abs(nx - ny) < 0.26 and abs(nx) <= 1.0 and abs(ny) <= 1.0
            on_diag2 = abs(nx + ny) < 0.26 and abs(nx) <= 1.0 and abs(ny) <= 1.0
            if on_diag1 or on_diag2:
                row.extend((255, 255, 255, 255))
            else:
                row.extend((r, g, b, 255))
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def generate_icons():
    icons_dir = SRC / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        (icons_dir / f"{size}.png").write_bytes(make_png(size))


def validate_manifest():
    manifest_path = SRC / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest.get("manifest_version") == 3, "Must be MV3"

    referenced = []
    for p in manifest.get("icons", {}).values():
        referenced.append(p)
    for p in manifest.get("action", {}).get("default_icon", {}).values():
        referenced.append(p)
    if "default_popup" in manifest.get("action", {}):
        referenced.append(manifest["action"]["default_popup"])
    if "service_worker" in manifest.get("background", {}):
        referenced.append(manifest["background"]["service_worker"])
    for cs in manifest.get("content_scripts", []):
        referenced.extend(cs.get("js", []))
        referenced.extend(cs.get("css", []))

    missing = [p for p in referenced if not (SRC / p).is_file()]
    if missing:
        raise FileNotFoundError(f"Missing files referenced in manifest.json: {missing}")

    return manifest


def build():
    generate_icons()
    manifest = validate_manifest()

    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(SRC, DIST)

    zip_path = ROOT / f"x-llm-translator-v{manifest['version']}.zip"
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(DIST.rglob("*")):
            if file_path.is_file():
                zf.write(file_path, file_path.relative_to(DIST))

    print(f"Built {manifest['name']} v{manifest['version']}")
    print(f"Unpacked dir: {DIST}")
    print(f"Zip package:  {zip_path} ({zip_path.stat().st_size} bytes)")


if __name__ == "__main__":
    build()
