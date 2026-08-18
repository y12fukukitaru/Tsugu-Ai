# -*- coding: utf-8 -*-
# アプリアイコンを作り直すための版下。手で画像を触らず、ここを直して焼き直す。
#
#   python3 tools/build-icons.py
#   （出力はリポジトリ直下に上書きされる。作業用の中間ファイルは
#     tools/_work/ に出るので、そこは追跡しない）
#
# 焼くもの
#   apple-touch-icon.png   180  iOSのホーム画面
#   icon-192 / icon-512    PWA（purpose:any）
#   icon-512-maskable      Androidが円などで切り抜く版。中央80%に収める
#   favicon-16 / 32 / ico  文字が読めない小ささなので継ナビくんだけ
#   ogp.png           1200x630  リンクを送ったときのサムネイル
import io, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # リポジトリ直下
WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_work")
os.makedirs(WORK, exist_ok=True)
CHROME = "/opt/pw-browsers/chromium"

NAVY_T, NAVY_B = "#0E1B33", "#1B3560"   # 背景の縦グラデーション（写真のメニューに合わせる）
RING          = "#C9A961"               # 金の輪
FACE_GOLD     = "#CFA860"               # 継ナビくんの金
INK           = "#1E3A66"               # 目と口

# 継ナビくんの図形（アプリ内の丸窓に入っているものと同じ）
SHAPES = ('<path d="M32 3 L34.6 10.4 L42 13 L34.6 15.6 L32 23 L29.4 15.6 L22 13 L29.4 10.4 Z" fill="%s"/>'
          '<rect x="9.5" y="32" width="5" height="12" rx="2.5" fill="%s"/>'
          '<rect x="49.5" y="32" width="5" height="12" rx="2.5" fill="%s"/>'
          '<rect x="14" y="23" width="36" height="30" rx="10" fill="#fff" stroke="%s" stroke-width="1.6"/>'
          '<circle cx="25" cy="36" r="3.1" fill="%s"/><circle cx="39" cy="36" r="3.1" fill="%s"/>'
          '<circle cx="20.5" cy="43" r="2.4" fill="%s" opacity=".35"/>'
          '<circle cx="43.5" cy="43" r="2.4" fill="%s" opacity=".35"/>'
          '<path d="M26.5 43.5 Q32 47.5 37.5 43.5" fill="none" stroke="%s" stroke-width="2.2" '
          'stroke-linecap="round"/>') % (FACE_GOLD, FACE_GOLD, FACE_GOLD, FACE_GOLD,
                                        INK, INK, FACE_GOLD, FACE_GOLD, INK)

# 丸窓に入れる用（全身がそのまま入る）
NAVI = '<svg x="{x}" y="{y}" width="{w}" height="{w}" viewBox="6 0 52 56">' + SHAPES + '</svg>'

# 切り取る範囲と置き場所を指定できる版。favicon は顔を目一杯にしたいので、
# 丸窓用とは違う切り取り方をする。
NAVI_BOX = ('<svg x="{x}" y="{y}" width="{w}" height="{h}" viewBox="{vb}" '
            'preserveAspectRatio="xMidYMid meet">' + SHAPES + '</svg>')

def badge(cx, cy, r, ring_w):
    """金の輪の丸窓に継ナビくんを収める。輪と中身の比はアプリ内の丸窓と同じ（約59%）。"""
    w = r * 2 * 0.59
    return ('<circle cx="%g" cy="%g" r="%g" fill="#0E2038"/>'
            '<circle cx="%g" cy="%g" r="%g" fill="none" stroke="%s" stroke-width="%g"/>'
            % (cx, cy, r, cx, cy, r - ring_w / 2.0, RING, ring_w)) + \
           NAVI.format(x=cx - w / 2.0, y=cy - w / 2.0, w=w)

def svg(kind):
    S = 1024
    bg = ('<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
          '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient></defs>'
          '<rect width="%d" height="%d" fill="url(#g)"/>' % (NAVY_T, NAVY_B, S, S))
    if kind == "full":            # 継ナビくん＋TSUGU AI（ホーム画面・PWA用）
        # ホーム画面では60pt前後でしか出ない。余白を切り詰め、丸と文字を
        # 目一杯に取る。飾り罫はその大きさでは滲むだけなので入れない。
        body = badge(512, 385, 295, 15) + (
            '<text x="512" y="838" text-anchor="middle" fill="%s" '
            'font-family="Liberation Serif,DejaVu Serif,serif" font-size="138" '
            'letter-spacing="20" style="text-indent:0">TSUGU AI</text>' % RING)
    elif kind == "mark":          # favicon 用。継ナビくんだけを、地いっぱいに
        # 16pxでは金の輪が外周を食い、中の顔が潰れて何も読めなくなる。
        # 実際に16pxで焼いて比べて分かった。輪は外し、きらめきから体まで
        # 入れて縦横いっぱいに置く。この大きさで効くのは
        # 「白い顔・黒い目ふたつ・上の金」という塊の形だけ。
        body = ('<rect width="%d" height="%d" fill="%s"/>' % (S, S, NAVY_T)) + \
               NAVI_BOX.format(vb="9 2 46 52", x=100, y=60, w=824, h=904)
    else:                         # maskable（Androidが円などで切り抜く。中央80%に収める）
        body = badge(512, 512, 300, 16)
    return ('<svg id="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
            'width="%d" height="%d">%s%s</svg>') % (S, S, S, S, bg, body)

def ogp_svg():
    """リンク共有のサムネイル（1200x630）。

    LINEなどは横長のまま出すとは限らず、真ん中を正方形に切って小さく
    出すことがある。実際にトーク画面ではそうなっていた。だから大事なもの
    （継ナビくんと TSUGU AI）は中央の630角に収める。両端は地だけにする。
    """
    W, H = 1200, 630
    bg = ('<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
          '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient></defs>'
          '<rect width="%d" height="%d" fill="url(#g)"/>' % (NAVY_T, NAVY_B, W, H))
    rules = ('<rect x="0" y="0" width="%d" height="7" fill="%s"/>'
             '<rect x="0" y="%d" width="%d" height="7" fill="%s"/>' % (W, RING, H - 7, W, RING))
    jp = "IPAPGothic,IPAGothic,Noto Sans JP,sans-serif"
    body = badge(600, 196, 112, 6) + (
        '<text x="600" y="392" text-anchor="middle" fill="%s" '
        'font-family="Liberation Serif,DejaVu Serif,serif" font-size="62" letter-spacing="9">'
        'TSUGU AI -継-</text>'
        '<text x="600" y="472" text-anchor="middle" fill="#FFFFFF" font-family="%s" '
        'font-size="42" font-weight="bold">AIと人で、会社の未来を継ぐ。</text>'
        '<text x="600" y="536" text-anchor="middle" fill="#B9C6DA" font-family="%s" '
        'font-size="25">資金繰り改善 ・ AI自動化 ・ 事業承継 / M&amp;A</text>'
        % (RING, jp, jp))
    return ('<svg id="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
            'width="%d" height="%d">%s%s%s</svg>') % (W, H, W, H, bg, rules, body)

def render_ogp(path):
    from PIL import Image
    W, H = 1200, 630
    html = ('<meta charset="utf-8"><style>html,body{margin:0;padding:0;}'
            '#ic{display:block;width:%dpx;height:%dpx;}</style>%s' % (W, H, ogp_svg()))
    h = os.path.join(WORK, "_t_ogp.html")
    io.open(h, "w", encoding="utf-8").write(html)
    shot = os.path.join(WORK, "_shot_ogp.png")
    subprocess.run([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
                    "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--window-size=1400,900", "--screenshot=" + shot, "file://" + h],
                   check=True, capture_output=True)
    im = Image.open(shot).convert("RGB").crop((0, 0, W, H))
    assert im.getpixel((600, H - 2)) != (255, 255, 255), "版下の下端が白い"
    im.save(path)
    print("  %-22s %dx%d" % (os.path.basename(path), W, H))

def render(kind, size, path):
    """1024で1枚だけ焼いて、そこから各寸法に落とす。

    headless の表示領域は --window-size より約87px低く、指定どおりの大きさで
    焼くと下がはみ出して白く抜ける。実際に測って分かった。窓を十分大きく取り、
    左上の1024角を切り出す形にすれば、その差に左右されない。
    """
    from PIL import Image
    src = os.path.join(WORK, "_src_%s.png" % kind)
    if not os.path.exists(src):
        html = ('<meta charset="utf-8"><style>html,body{margin:0;padding:0;'
                'background:transparent;}#ic{display:block;width:1024px;height:1024px;}'
                '</style>%s' % svg(kind))
        h = os.path.join(WORK, "_t_%s.html" % kind)
        io.open(h, "w", encoding="utf-8").write(html)
        shot = os.path.join(WORK, "_shot_%s.png" % kind)
        subprocess.run([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
                        "--hide-scrollbars", "--force-device-scale-factor=1",
                        "--window-size=1200,1400", "--screenshot=" + shot, "file://" + h],
                       check=True, capture_output=True)
        im = Image.open(shot).convert("RGBA").crop((0, 0, 1024, 1024))
        # 焼けているか（下端まで背景があるか）を確かめてから使う
        px = im.convert("RGB").getpixel((512, 1023))
        assert px != (255, 255, 255), "版下の下端が白い（切り出しがずれている）: %s" % (px,)
        im.save(src)
    Image.open(src).resize((size, size), Image.LANCZOS).save(path)
    print("  %-22s %4dpx" % (os.path.basename(path), size))

targets = [
    ("full", 180, "apple-touch-icon.png"),
    ("full", 192, "icon-192.png"),
    ("full", 512, "icon-512.png"),
    ("mask", 512, "icon-512-maskable.png"),
    ("mark",  32, "favicon-32.png"),
    ("mark",  16, "favicon-16.png"),
]
print("焼きます:")
for kind, size, name in targets:
    render(kind, size, os.path.join(ROOT, name))

# favicon.ico（16/32/48 を1つに）
from PIL import Image
render("mark", 48, os.path.join(WORK, "_f48.png"))
base = Image.open(os.path.join(WORK, "_f48.png")).convert("RGBA")
base.save(os.path.join(ROOT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
print("  favicon.ico            16/32/48")
render_ogp(os.path.join(ROOT, "ogp.png"))
