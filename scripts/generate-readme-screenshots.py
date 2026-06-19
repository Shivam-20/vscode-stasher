#!/usr/bin/env python3
"""Generate compressed README screenshots from HTML mock."""
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow required: pip install pillow", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "scripts" / "readme-screenshots.html"
OUT = ROOT / "docs" / "screenshots"
SHOTS = [
    ("working-changes", "working-changes.png"),
    ("stashes", "stashes.png"),
]


def capture_with_playwright() -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "playwright"], check=True)
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
        from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(device_scale_factor=2, viewport={"width": 900, "height": 1200})
        page.goto(HTML.as_uri())
        for elem_id, filename in SHOTS:
            page.locator(f"#{elem_id}").screenshot(path=str(OUT / filename))
        browser.close()


def compress(path: Path, max_width: int = 760) -> None:
    img = Image.open(path)
    if img.width > max_width:
        ratio = max_width / img.width
        img = img.resize((max_width, int(img.height * ratio)), Image.Resampling.LANCZOS)
    img.save(path, "PNG", optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        capture_with_playwright()
    except Exception as e:
        print(f"Playwright capture failed ({e}); compressing existing PNGs if present.", file=sys.stderr)
        if not all((OUT / f).exists() for _, f in SHOTS):
            sys.exit(1)

    for _, filename in SHOTS:
        compress(OUT / filename)
        size_kb = (OUT / filename).stat().st_size // 1024
        print(f"Wrote {OUT / filename} ({size_kb} KB)")


if __name__ == "__main__":
    main()
