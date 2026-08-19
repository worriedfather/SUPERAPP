from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(OUT, '..', 'public', 'da-logo.png')

NAVY_TOP = (34, 52, 92)      # #22345C
NAVY_BOT = (20, 33, 61)      # #14213D
LIME = (107, 192, 72)        # #6BC048
MUTED = (159, 176, 208)      # #9FB0D0

def vgrad(w, h, top, bot):
    img = Image.new('RGB', (w, h), top)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    return img

def font(size, bold=True):
    for p in [r'C:\Windows\Fonts\arialbd.ttf' if bold else r'C:\Windows\Fonts\arial.ttf',
              r'C:\Windows\Fonts\ariblk.ttf']:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

logo = Image.open(LOGO).convert('RGBA')

# ---- 512 x 512 high-res icon ----
ic = vgrad(512, 512, NAVY_TOP, NAVY_BOT).convert('RGBA')
lw, lh = logo.size
scale = min(320 / lw, 320 / lh)
lg = logo.resize((int(lw * scale), int(lh * scale)), Image.LANCZOS)
ic.alpha_composite(lg, ((512 - lg.width) // 2, (512 - lg.height) // 2 - 6))
ic.convert('RGB').save(os.path.join(OUT, 'icon-512.png'))

# ---- 1024 x 500 feature graphic ----
fg = vgrad(1024, 500, NAVY_TOP, NAVY_BOT).convert('RGBA')
d = ImageDraw.Draw(fg)
# logo on the left
scale = min(300 / lw, 300 / lh)
lg2 = logo.resize((int(lw * scale), int(lh * scale)), Image.LANCZOS)
fg.alpha_composite(lg2, (90, (500 - lg2.height) // 2))
# text block on the right
x = 430
d.text((x, 150), 'DA ', font=font(96), fill=(234, 240, 250))
w1 = d.textlength('DA ', font=font(96))
d.text((x + w1, 150), 'OPS', font=font(96), fill=LIME)
# tagline — shrink to fit inside the canvas with a right margin
tag = 'RETAIL · LOGISTICS · FLEET · WORKSHOP'
tf = font(26)
while d.textlength(tag, font=tf) > (1024 - x - 40) and tf.size > 14:
    tf = font(tf.size - 1)
d.text((x + 3, 285), tag, font=tf, fill=MUTED)
fg.convert('RGB').save(os.path.join(OUT, 'feature-1024x500.png'))

print('icon-512.png', Image.open(os.path.join(OUT, 'icon-512.png')).size)
print('feature-1024x500.png', Image.open(os.path.join(OUT, 'feature-1024x500.png')).size)
