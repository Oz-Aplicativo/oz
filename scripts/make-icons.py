from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "images" / "oz-logo-new.png"
OUT = ROOT / "icons"
ASSETS = ROOT / "assets"
BG = (1, 4, 16, 255)

OUT.mkdir(exist_ok=True)
ASSETS.mkdir(exist_ok=True)

src = Image.open(SRC).convert("RGBA")
pixels = src.getdata()
bbox = src.getbbox()
if bbox:
    src = src.crop(bbox)


def fit(size: int, pad_ratio: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG)
    inner = max(1, int(size * (1 - 2 * pad_ratio)))
    logo = src.copy()
    logo.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    x = (size - logo.width) // 2
    y = (size - logo.height) // 2
    canvas.paste(logo, (x, y), logo)
    return canvas


sizes = {
    "icon-192.png": (192, 0.16),
    "icon-512.png": (512, 0.16),
    "icon-192-maskable.png": (192, 0.22),
    "icon-512-maskable.png": (512, 0.22),
    "apple-touch-icon.png": (180, 0.16),
    "favicon-32.png": (32, 0.12),
}

for name, (size, pad) in sizes.items():
    fit(size, pad).save(OUT / name, "PNG")

icon_1024 = fit(1024, 0.16)
icon_1024.save(ASSETS / "icon.png", "PNG")
icon_1024.save(OUT / "icon-1024.png", "PNG")

splash = Image.new("RGBA", (2732, 2732), BG)
mark = fit(900, 0.18)
sx = (2732 - mark.width) // 2
sy = (2732 - mark.height) // 2
splash.paste(mark, (sx, sy), mark)
splash.save(ASSETS / "splash.png", "PNG")

print("icons ok")
