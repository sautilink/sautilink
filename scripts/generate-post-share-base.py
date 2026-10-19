"""Rebuild the static share-card canvas with Pillow; no runtime image dependency."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
width, height = 1200, 630
image = Image.new('RGB', (width, height))
pixels = image.load()
for y in range(height):
    for x in range(width):
        amount = (x + y) / (width + height - 2)
        pixels[x, y] = tuple(round(a + (b - a) * amount) for a, b in zip((7, 16, 31), (16, 28, 49)))
image = image.convert('RGBA')
overlay = Image.new('RGBA', image.size)
draw = ImageDraw.Draw(overlay)
draw.ellipse((870, -120, 1290, 300), fill=(230, 32, 90, 31))
draw.ellipse((840, 240, 1400, 800), fill=(36, 107, 254, 31))
image = Image.alpha_composite(image, overlay)
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((70, 62, 1130, 568), radius=32, fill='#0b1525', outline='#33415a', width=2)
logo = Image.open(root / 'logo.png').convert('RGBA')
logo.thumbnail((110, 54), Image.Resampling.LANCZOS)
image.alpha_composite(logo, (978, 104))
target = root / 'app/assets/post-share-base.png'
image.convert('RGB').save(target, optimize=True)
print(f'{target.name}: {width}x{height}, {target.stat().st_size} bytes')
