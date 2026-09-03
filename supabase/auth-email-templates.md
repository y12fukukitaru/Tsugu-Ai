# 登録メールを TsuguAi -継- の名前にする（作業手順）

## これは何をする作業か

経営者がプラットフォームに新規登録すると、**「メールアドレスを確認してください」というメールが自動で届きます。**
このメールだけは、私たちが書いたプログラムではなく **Supabase という土台のサービスが自分で送っています。**

だから、いま何もしないと、経営者が受け取る**いちばん最初の一通**はこうなります。

```
差出人：Supabase Auth <noreply@mail.app.supabase.io>
件名：Confirm Your Signup
本文：Follow this link to confirm your user:  Confirm your mail
```

英語で、知らない会社の名前です。ここで手が止まる方が出ます。

**さらに大事なこと**：この Supabase の標準の送信機能は、**1時間に2〜3通しか送れません。**
9/12 に何人も登録すると、3人目から確認メールが届かなくなります。
つまりこれは「見た目を整える」話ではなく、**登録できるかどうかの話**です。

## 作業は3つ

| | やること | かかる時間 |
|---|---|---|
| 手順1 | 送信を Resend（すでに使っているメール配信サービス）に切り替える | 7分 |
| 手順2 | メールの文面を日本語に差し替える | 7分 |
| 手順3 | 実際に登録してみて、確かめる | 3分 |

**手順1がいちばん大事です。** ここだけでも、届かなくなる問題は解決します。
文面（手順2）は後日でも構いません。

---

# 準備：Resend の API キーを用意する

手順1で「パスワード」として使います。`re_` で始まる長い文字列です。

1. https://resend.com にログイン
2. 左のメニューから **「API Keys」**
3. すでにキーが並んでいますが、**中身は二度と表示されません**（作ったときの一度きり）
4. 手元に控えが無ければ、**「Create API Key」** で新しく作ります
   - Name：`supabase-auth` など、分かる名前で
   - Permission：**Full access**
   - **作成直後に表示される文字列をコピーして、メモ帳などに貼っておいてください**（画面を閉じると二度と見られません）

> 古いキーは消さないでください。Edge Function（週の便りなど）が使っています。

---

# 手順1：送信を Resend に切り替える

## 1-1. 設定画面を開く

Supabase のダッシュボードで、**左下の歯車マーク（⚙ Project Settings）** をクリック。
左に設定の項目が並ぶので、**「Authentication」** を探してクリック。

> 見当たらないときは、画面上の検索窓（Search... Ctrl+K）に **`SMTP`** と打つと、その設定画面に直接行けます。

## 1-2. スイッチを入れる

**「SMTP Settings」** という見出しを探します。その中に
**「Enable Custom SMTP」** というスイッチがあるので、**オンにします。**

スイッチを入れると、入力欄が現れます。

## 1-3. 6つの欄を埋める

| 欄の名前 | 入れる値 |
|---|---|
| Sender email | `noreply@fuku-tsugu.jp` |
| Sender name | `TsuguAi -継-` |
| Host | `smtp.resend.com` |
| Port number | `465` |
| Username | `resend` |
| Password | 準備で用意した API キー（`re_` で始まるもの） |

**Username は、あなたのメールアドレスではなく `resend` という文字そのもの**です。ここを間違えやすいのでご注意ください。

入れ終わったら **「Save」**。

## 1-4. 送信できる数を増やす

同じページを下にスクロールすると **「Rate Limits」** という項目があります。
**「Rate limit for sending emails」** の数字を **`30`** にして **Save**。

これで「1時間に30通まで」になります。標準の2〜3通のままだと、ローンチ日に詰まります。

**ここまでで手順1は完了です。** この時点で、登録メールの差出人は `TsuguAi -継-` になり、通数の心配も無くなります。

---

# 手順2：文面を日本語にする

## 2-1. 文面の画面を開く

左のメニュー（歯車ではなく、通常のメニュー）から
**「Authentication」→「Emails」**（または「Email Templates」）を開きます。

左側に4つのタブが並んでいます。

- **Confirm signup** … 新規登録の確認 ← **いちばん大事**
- **Reset Password** … パスワードを忘れたとき
- **Magic Link** … いまは使っていません
- **Change Email Address** … メールアドレスの変更

## 2-2. Confirm signup を差し替える

**「Confirm signup」** のタブを開くと、2つの入力欄があります。

**① Subject heading（件名）**
中身を全部消して、これを貼る：

```
【TsuguAi -継-】メールアドレスの確認をお願いします
```

**② Message body（本文）**
中身を全部消して（`Ctrl+A` で全選択 → `Delete`）、これを貼る：

```html
<div style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18202E;line-height:1.9;">
  <div style="font-size:13px;color:#C39B3F;font-weight:bold;">✦ 継ナビくんです</div>
  <h2 style="font-size:17px;color:#1E3A66;margin:8px 0 14px;">ご登録ありがとうございます</h2>
  <p style="font-size:14px;">TsuguAi -継- へのご登録を受け付けました。<br>
  下のボタンを押すと、メールアドレスの確認が終わります。</p>
  <div style="margin:18px 0;">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#1E3A66;color:#fff;text-decoration:none;font-size:13px;font-weight:bold;padding:11px 22px;border-radius:9px;">メールアドレスを確認する →</a>
  </div>
  <p style="font-size:12px;color:#5A6981;">ボタンが押せないときは、次のリンクをブラウザに貼り付けてください。<br>
  <span style="word-break:break-all;">{{ .ConfirmationURL }}</span></p>
  <p style="font-size:12px;color:#5A6981;">確認のあと、ログイン画面からお入りください。担当の認定パートナーがあなたのメールアドレスを登録すると、画面が開きます。</p>
  <div style="font-size:11px;color:#5A6981;line-height:1.7;margin-top:18px;">このメールは TsuguAi -継- が、ご登録の直後に自動でお送りしています。お心当たりがない場合は、このまま破棄してください。</div>
</div>
```

**Save** を押します。

> **`{{ .ConfirmationURL }}` は消さないでください。** ここに Supabase が「確認用のリンク」を自動で埋め込みます。
> 貼り付けたあと、この文字がちゃんと残っているか目で見てください。

## 2-3. Reset Password を差し替える

**「Reset Password」** のタブで、同じことをします。

**件名**

```
【TsuguAi -継-】パスワード再設定のご案内
```

**本文**

```html
<div style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18202E;line-height:1.9;">
  <div style="font-size:13px;color:#C39B3F;font-weight:bold;">✦ 継ナビくんです</div>
  <h2 style="font-size:17px;color:#1E3A66;margin:8px 0 14px;">パスワードを再設定します</h2>
  <p style="font-size:14px;">下のボタンから、新しいパスワードを設定してください。</p>
  <div style="margin:18px 0;">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#1E3A66;color:#fff;text-decoration:none;font-size:13px;font-weight:bold;padding:11px 22px;border-radius:9px;">新しいパスワードを設定する →</a>
  </div>
  <p style="font-size:12px;color:#5A6981;">ボタンが押せないときは、次のリンクをブラウザに貼り付けてください。<br>
  <span style="word-break:break-all;">{{ .ConfirmationURL }}</span></p>
  <div style="font-size:11px;color:#5A6981;line-height:1.7;margin-top:18px;">このメールは TsuguAi -継- が、再設定のお申し込みを受けて自動でお送りしています。お申し込みでない場合は、このまま破棄してください。パスワードは変わりません。</div>
</div>
```

## 2-4. 残り2つ（急ぎません）

**Magic Link** はいまの画面では使っていません。**Change Email Address** も、当面は出番がありません。
お時間のあるときで構いませんので、下を貼っておくと揃います。

**Magic Link — 件名**

```
【TsuguAi -継-】ログイン用のリンク
```

**Magic Link — 本文**

```html
<div style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18202E;line-height:1.9;">
  <div style="font-size:13px;color:#C39B3F;font-weight:bold;">✦ 継ナビくんです</div>
  <h2 style="font-size:17px;color:#1E3A66;margin:8px 0 14px;">ログイン用のリンクです</h2>
  <div style="margin:18px 0;">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#1E3A66;color:#fff;text-decoration:none;font-size:13px;font-weight:bold;padding:11px 22px;border-radius:9px;">ログインする →</a>
  </div>
  <div style="font-size:11px;color:#5A6981;line-height:1.7;margin-top:18px;">このメールは TsuguAi -継- が自動でお送りしています。お心当たりがない場合は、このまま破棄してください。</div>
</div>
```

**Change Email Address — 件名**

```
【TsuguAi -継-】メールアドレス変更の確認
```

**Change Email Address — 本文**

```html
<div style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18202E;line-height:1.9;">
  <div style="font-size:13px;color:#C39B3F;font-weight:bold;">✦ 継ナビくんです</div>
  <h2 style="font-size:17px;color:#1E3A66;margin:8px 0 14px;">メールアドレスの変更を確認します</h2>
  <p style="font-size:14px;">{{ .Email }} から {{ .NewEmail }} への変更を受け付けました。<br>下のボタンで確定します。</p>
  <div style="margin:18px 0;">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#1E3A66;color:#fff;text-decoration:none;font-size:13px;font-weight:bold;padding:11px 22px;border-radius:9px;">変更を確定する →</a>
  </div>
  <div style="font-size:11px;color:#5A6981;line-height:1.7;margin-top:18px;">このメールは TsuguAi -継- が自動でお送りしています。お心当たりがない場合は、このまま破棄してください。変更は行われません。</div>
</div>
```

---

# 手順3：本当に直ったか確かめる

## 3-0. 先に、リンクの戻り先を見ておく

左のメニューから **「Authentication」→「URL Configuration」**。

**Site URL** が次のようになっているか確認してください。

```
https://y12fukukitaru.github.io/Tsugu-Ai/
```

`http://localhost:3000` のままだと、経営者が確認ボタンを押したときに
**自分のパソコンの中**に飛ばされてしまい、画面が開きません。違っていたら直して Save。

## 3-1. 登録してみる

**まだ使っていないメールアドレス**（Gmail なら `kit.12.rise+test1@gmail.com` のように
`+なにか` を足すと、同じ受信箱で新しいアドレスとして使えます）で、
プラットフォームから新規登録します。

## 3-2. 届いたメールを見る

| 見るところ | こうなっていれば成功 |
|---|---|
| 差出人の名前 | **TsuguAi -継-** |
| 差出人のアドレス | noreply@fuku-tsugu.jp |
| 件名 | **【TsuguAi -継-】メールアドレスの確認をお願いします** |
| 本文の1行目 | ✦ 継ナビくんです |

## 3-3. 最後まで通してみる

ボタンを押す → プラットフォームに戻る → ログイン →
**「担当パートナーの登録を待っています」** という画面が出れば、すべて正常です。

この画面は、担当パートナーがまだ登録していないから出ています。**故障ではありません。**

---

# 困ったとき

| 症状 | 原因と直しかた |
|---|---|
| メールが1通も届かない | 手順1が効いていません。Resend の画面 →「Emails」に送信の記録が出ているか見てください。無ければ、Username が `resend` になっているか、Password のキーが正しいかを確認 |
| 差出人が Supabase のまま | 「Enable Custom SMTP」のスイッチがオフに戻っています |
| 迷惑メールに入る | Resend 側で `fuku-tsugu.jp` のドメイン認証（DKIM/SPF）が済んでいるか確認。すでに週の便りが届いているなら、済んでいます |
| ボタンを押すと localhost に飛ぶ | 手順3-0の Site URL が直っていません |
| 本文が崩れて表示される | 貼り付けが途中で切れています。`Ctrl+A` で全部消してから貼り直してください |

---

# なぜこのメールだけ Dashboard で設定するのか

週の便り・毎朝のリマインド・月次レポートは、こちらで書いたプログラム（Edge Function）が
メールを送っているので、名乗りも文面もリポジトリの中で決められます。

**登録の確認とパスワード再設定だけは、Supabase が自分で送ります。**
プログラムを通らないので、Dashboard で設定するしかありません。

この文書は、その設定内容をリポジトリに残しておくためのものです。
次に屋号や差出人を変えるとき、ここを見ればどこを触ればよいか分かります。
