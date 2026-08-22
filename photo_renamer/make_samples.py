# -*- coding: utf-8 -*-
"""연습용 샘플 부품 사진 생성기 — sample_photos/ 에 라벨이 인쇄된 가상 부품 사진을 만든다.
실행: python3 make_samples.py  (pillow 필요)
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample_photos")
os.makedirs(OUT, exist_ok=True)


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def label_photo(fname, part, brand, box_color, with_label=True, note=""):
    img = Image.new("RGB", (900, 640), (208, 206, 200))       # 작업대 배경
    d = ImageDraw.Draw(img)
    d.rectangle([140, 90, 760, 560], fill=box_color)           # 부품 박스
    d.rectangle([140, 90, 760, 560], outline=(60, 60, 60), width=4)
    if with_label:
        d.rectangle([200, 150, 700, 380], fill=(248, 248, 244))  # 라벨
        d.rectangle([200, 150, 700, 380], outline=(90, 90, 90), width=3)
        d.text((230, 175), brand, fill=(20, 20, 20), font=font(42))
        d.text((230, 250), "PART NO", fill=(90, 90, 90), font=font(26))
        d.text((230, 285), part, fill=(10, 10, 10), font=font(56))
        d.text((230, 360), "MADE IN KOREA", fill=(120, 120, 120), font=font(18))
    else:
        d.text((300, 300), note or "(측면 사진 — 라벨 없음)", fill=(70, 70, 70), font=font(28))
    img.save(os.path.join(OUT, fname), quality=90)


# 부품 3종 × 사진 2~3장 (일부는 라벨 없는 측면 사진 → 앞 품번 이어받기 시나리오)
label_photo("IMG_0001.jpg", "15KA-72040", "HYUNDAI CONSTRUCTION EQUIPMENT", (34, 96, 50))
label_photo("IMG_0002.jpg", "", "", (34, 96, 50), with_label=False)
label_photo("IMG_0003.jpg", "1DFQ-60200", "FLEETGUARD", (150, 60, 40))
label_photo("IMG_0004.jpg", "", "", (150, 60, 40), with_label=False)
label_photo("IMG_0005.jpg", "31LM-10310", "HYUNDAI", (40, 60, 120))
label_photo("IMG_0006.jpg", "31LM-10310", "HYUNDAI", (40, 60, 120))
label_photo("IMG_0007.jpg", "", "", (40, 60, 120), with_label=False)

print("샘플 사진 7장 생성 완료 →", OUT)
