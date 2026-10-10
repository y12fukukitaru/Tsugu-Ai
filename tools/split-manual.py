#!/usr/bin/env python3
"""経営者向け説明書を、買い手版と売り手版に分ける。

  元（両方入り）: manual-customer.html … 書き直すのはこの1本だけ
  できるもの    : manual-buyer.html（買い手プラン）／manual-seller.html（売り手プラン）

  元の書き方:
    <section class="slide" data-plan="buyer" …>   その頁は買い手版だけに残す（seller も同じ）
    <!--plan:buyer-->…<!--/plan-->               その部分は買い手版だけに残す（元にも出る）
    <!--plan:master-->…<!--/plan-->              元（両方入り）だけに出す
    <!--only:seller …-->                         元には出さず、売り手版でだけ出す

  使い方:  python3 tools/split-manual.py          … 2本を書き出す
           python3 tools/split-manual.py --check  … 書き出したものが元と合っているかだけ確かめる
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'manual-customer.html'
PLANS = {
    'buyer': ('manual-buyer.html', '買い手プラン（成長）'),
    'seller': ('manual-seller.html', '売り手プラン（譲渡準備）'),
}
NOTE = '<!-- このファイルは tools/split-manual.py が manual-customer.html から作ります。直すときは元を直して、もう一度実行してください -->\n'


def build(src, plan):
    out = src
    # 頁（section）ごと：ほかのプランの頁を落とす
    def drop_slide(m):
        return '' if m.group(1) != plan else m.group(0)
    out = re.sub(r'<section class="slide" data-plan="(\w+)"[\s\S]*?</section>\n*', drop_slide, out)
    out = out.replace(' data-plan="' + plan + '"', '')
    # 部分ごと
    def keep_part(m):
        return m.group(2) if m.group(1) == plan else ''
    out = re.sub(r'<!--plan:(\w+)-->\n?([\s\S]*?)<!--/plan-->\n?', keep_part, out)
    def only_part(m):
        return m.group(2) if m.group(1) == plan else ''
    out = re.sub(r'<!--only:(\w+)[ \n]([\s\S]*?)-->\n?', only_part, out)
    # 表紙と題
    label = PLANS[plan][1]
    out = out.replace('<title>経営者ダッシュボード 操作説明書 |',
                      '<title>経営者ダッシュボード 操作説明書（' + label + '） |', 1)
    out = out.replace('<h1>経営者ダッシュボード<br>操作説明書</h1>',
                      '<h1>経営者ダッシュボード<br>操作説明書</h1>\n  <div class="mark" style="margin-top:10px;">' + label + 'の方へ</div>', 1)
    out = out.replace('<head>\n', '<head>\n' + NOTE, 1)
    return out


def main():
    src = SRC.read_text(encoding='utf-8')
    check = '--check' in sys.argv
    bad = []
    for plan, (name, _) in PLANS.items():
        got = build(src, plan)
        assert '<!--plan:' not in got and '<!--only:' not in got and 'data-plan=' not in got, plan
        path = ROOT / name
        if check:
            if not path.exists() or path.read_text(encoding='utf-8') != got:
                bad.append(name)
        else:
            path.write_text(got, encoding='utf-8')
            print(name, got.count('<section class="slide'), 'slides')
    if bad:
        print('元（manual-customer.html）と合っていません。python3 tools/split-manual.py を実行してください:', ', '.join(bad))
        sys.exit(1)


if __name__ == '__main__':
    main()
