"""Generate QR with Korean message inside black modules only."""
from __future__ import annotations

import re
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

URL = "https://vikmil.com/hbdchaeyoung/"
OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "assets"
PHOTO = Path(__file__).resolve().parents[1] / "public" / "assets" / "album-4824.jpg"

# Why I Like You — Korean (s4 voice note)
WHY_KO = (
    "내가 너를 보면서 늘 정말 대단하다고 느꼈던 게 하나 있어. "
    "나를 만나기 전부터 너는 이미 정말 많은 걸 이뤄냈잖아. "
    "한국에서 번듯한 금융권 직장도 있었고, 편안한 삶도 있었고, 책까지 냈어. "
    "대부분의 사람이라면 그 정도면 충분하다고 생각했을 거야. "
    "그런데 너는 그 모든 걸 뒤로하고 다른 나라로 떠나기로 했어. "
    "큰 위험을 감수하고, 대출까지 받아서 석사 공부를 시작하고, "
    "완전히 새로운 삶을 맨바닥부터 다시 만들어갔지. "
    "그리고 너는 지금도 계속 멋지게 해내고 있어. "
    "공부부터 두두루, 그리고 마케팅·운영 리드가 되기까지, "
    "너는 뭘 하든 절대 대충 하지 않는 것 같아. "
    "한번 하기로 마음먹으면 정말 끝까지 해내잖아. "
    "일이든, 복싱이든, 체중을 감량하는 일이든, 철저하게 식단을 지키는 일이든. "
    "솔직히 그런 면에서 우리는 꽤 다른 것 같아. "
    "나는 내가 뭘 하고 있는지 전혀 모르겠다고 느꼈던 순간도 많았어. "
    "스트레스를 받고, 자신감이 없어지고, 모든 걸 너무 깊이 생각하면서 "
    "그냥 내 삶을 어떻게 살아가야 할지 알아가려고 했어. "
    "그런데도 너는 늘 인내심을 가지고 나를 응원하고 지지해줬어. "
    "네가 내가 왜 그렇게 행동하는지 항상 이해하는 건 아니잖아. "
    "솔직히 말하면 나조차도 내가 왜 그러는지 모를 때가 있어. "
    "네가 내 생각에 항상 동의하는 것도 아니고. "
    "그런데도 너는 내가 나만의 방식으로 살아가고 있다는 걸 존중해줬어. "
    "나는 그게 정말 흔하지 않은 일이라고 생각해. "
    "그리고 그게 내가 너를 가장 존경하는 이유 중 하나야. "
    "우리가 함께한 많은 순간들 중에서, 내가 가장 좋아했던 것 중 하나는 "
    "어떤 여행이나 데이트, 혹은 특별한 한 가지 추억이 아니었어. "
    "그냥 너라는 사람을 알아가는 일이었어. "
    "겉으로 보이는 모습이 아니라, 진짜 너를. "
    "그리고 내가 진짜 너를 알게 돼서 정말 다행이야."
)
CARD_TITLE = "네가 좋은 이유"
CARD_SUB = "진짜 너를 알게 돼서 정말 다행이야"
KO_CHARS = [ch for ch in WHY_KO if re.match(r"[가-힣]", ch)]

WHITE = (255, 255, 255)
BLACK = (8, 12, 22)
GOLD_ON_BLACK = (218, 196, 148)
GOLD_SOFT = (190, 168, 118)
INK = (14, 20, 34)
TEXT = (30, 36, 48)
GOLD = (168, 145, 98)


BOLD_FONT = "C:/Windows/Fonts/malgunbd.ttf"


def load_font(size: int, korean: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if korean:
        try:
            return ImageFont.truetype(BOLD_FONT, size)
        except OSError:
            pass
    candidates = [
        "C:/Windows/Fonts/malgun.ttf",
        "C:/Windows/Fonts/NanumGothicBold.ttf",
    ] if korean else ["C:/Windows/Fonts/georgiab.ttf"]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_bold_hangul(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    char: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, int, int],
    *,
    stroke: int = 2,
) -> None:
    draw.text(
        xy,
        char,
        font=font,
        fill=fill,
        stroke_width=stroke,
        stroke_fill=(*INK, 255),
    )


def is_finder_zone(r: int, c: int, size: int) -> bool:
    return (r < 7 and c < 7) or (r < 7 and c >= size - 7) or (r >= size - 7 and c < 7)


def is_timing_zone(r: int, c: int, size: int) -> bool:
    return r == 6 or c == 6


def char_for_index(i: int) -> str:
    return KO_CHARS[i % len(KO_CHARS)]


def draw_hangul_dark_module(
    base: Image.Image,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    box: int,
    char: str,
    alt: bool,
    *,
    tint_alpha: int = 48,
) -> None:
    if tint_alpha > 0:
        tint = Image.new("RGBA", (box, box), (*BLACK, tint_alpha))
        cell = base.crop((x0, y0, x1, y1)).convert("RGBA")
        base.paste(Image.alpha_composite(cell, tint), (x0, y0))

    draw = ImageDraw.Draw(base)
    font_size = max(6, int(box * 0.30))
    font = load_font(font_size)
    bbox = draw.textbbox((0, 0), char, font=font, stroke_width=2)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = x0 + (box - tw) // 2 - bbox[0]
    ty = y0 + (box - th) // 2 - bbox[1]
    draw_bold_hangul(
        draw,
        (tx, ty),
        char,
        font,
        GOLD_SOFT if alt else GOLD_ON_BLACK,
        stroke=2,
    )


def punch_light_module(
    draw: ImageDraw.ImageDraw,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
) -> None:
    """qrbtf image style — crisp white cutouts over the photo."""
    draw.rectangle((x0, y0, x1, y1), fill=(*WHITE, 255))


def load_photo_background(size_px: int, zoom_out: float = 1.04) -> Image.Image:
    """Cover crop + mild contrast for qrbtf-style portrait QR."""
    if not PHOTO.exists():
        return Image.new("RGBA", (size_px, size_px), (*WHITE, 255))

    src = Image.open(PHOTO).convert("RGB")
    src = ImageEnhance.Contrast(src).enhance(1.12)
    src = ImageOps.grayscale(src).convert("RGBA")
    w, h = src.size
    scale = max(size_px / w, size_px / h) / zoom_out
    nw, nh = int(w * scale), int(h * scale)

    # Keep a true cover crop so the QR is never letterboxed with empty sides.
    if nw < size_px:
        scale *= size_px / nw
        nw = size_px
    if nh < size_px:
        scale *= size_px / nh
        nh = size_px

    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - size_px) // 2)
    top = max(0, int((nh - size_px) * 0.32))
    cropped = resized.crop((left, top, left + size_px, top + size_px))

    return cropped


def render_korean_qr(pixel_size: int = 1080) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=1,
        border=2,
    )
    qr.add_data(URL)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    modules = len(matrix)
    quiet = 2
    total = modules + quiet * 2
    box = max(8, pixel_size // total)
    size_px = total * box

    photo = load_photo_background(size_px)
    out = photo.copy()
    draw = ImageDraw.Draw(out)
    char_idx = 0

    # qrbtf image style: photo base, white punch-outs, bold hangul on dark cells.
    for r in range(total):
        for c in range(total):
            mr = r - quiet
            mc = c - quiet
            x0, y0 = c * box, r * box
            x1, y1 = x0 + box, y0 + box

            if mr < 0 or mc < 0 or mr >= modules or mc >= modules:
                draw.rectangle((x0, y0, x1, y1), fill=(*WHITE, 255))
                continue

            dark = matrix[mr][mc]
            reserved = is_finder_zone(mr, mc, modules) or is_timing_zone(mr, mc, modules)

            if reserved:
                draw.rectangle((x0, y0, x1, y1), fill=(*BLACK, 255) if dark else (*WHITE, 255))
                continue

            if dark:
                char = char_for_index(char_idx)
                char_idx += 1
                draw_hangul_dark_module(
                    out, x0, y0, x1, y1, box, char,
                    alt=char_idx % 2 == 0,
                    tint_alpha=48,
                )
            else:
                punch_light_module(draw, x0, y0, x1, y1)

    return out


def make_card(qr_img: Image.Image) -> Image.Image:
    pad_x, pad_top, pad_bottom = 64, 72, 56
    card_w = qr_img.width + pad_x * 2
    card_h = qr_img.height + pad_top + pad_bottom + 88

    card = Image.new("RGBA", (card_w, card_h), (*WHITE, 255))
    draw = ImageDraw.Draw(card)

    title_font = load_font(34)
    sub_font = load_font(15)
    url_font = load_font(13, korean=False)

    title = CARD_TITLE
    sub = CARD_SUB

    tb = draw.textbbox((0, 0), title, font=title_font)
    tw = tb[2] - tb[0]
    draw.text(((card_w - tw) // 2, 24), title, font=title_font, fill=TEXT)

    sb = draw.textbbox((0, 0), sub, font=sub_font)
    sw = sb[2] - sb[0]
    draw.text(((card_w - sw) // 2, 66), sub, font=sub_font, fill=GOLD)

    qr_x, qr_y = pad_x, pad_top
    card.paste(qr_img, (qr_x, qr_y), qr_img)

    hint = "vikmil.com/hbdchaeyoung"
    hb = draw.textbbox((0, 0), hint, font=url_font)
    hw = hb[2] - hb[0]
    draw.text(((card_w - hw) // 2, qr_y + qr_img.height + 20), hint, font=url_font, fill=(120, 120, 120))

    return card


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    qr = render_korean_qr(1080)
    qr_path = OUT_DIR / "happy-birthday-qr.png"
    qr.save(qr_path, "PNG")

    card = make_card(qr)
    card_path = OUT_DIR / "happy-birthday-qr-card.png"
    card.save(card_path, "PNG")

    chae_dir = Path("D:/CURSOR/chae")
    if chae_dir.exists():
        qr.save(chae_dir / "happy-birthday-qr.png", "PNG")
        card.save(chae_dir / "happy-birthday-qr-card.png", "PNG")

    print(f"URL: {URL}")
    print(f"Saved: {qr_path}")
    print(f"Saved: {card_path}")


if __name__ == "__main__":
    main()
