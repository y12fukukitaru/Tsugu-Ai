# 登録・ログインまわりのメール（Supabase Auth）を TsuguAi -継- の名乗りにする

経営者が最初に受け取るメールは、週の便りでも月次レポートでもなく、
**登録直後の「メールアドレスの確認」** です。ここが英語の定型文で、差出人が
`Supabase Auth <noreply@mail.app.supabase.io>` のままだと、最初の一通で
「知らない会社から英語のメールが来た」になります。

この文書は、その差し替え手順と文面です。**コードの変更は要りません。**
Dashboard で2か所を設定するだけです。

---

## 1. 差出人（Custom SMTP）— 先にこちら

`Dashboard → Project Settings → Authentication → SMTP Settings`

Supabase に最初から入っている送信機能は、**1時間に数通しか送れません**
（新規登録が続くと、確認メールが届かなくなります）。すでに Resend で
`fuku-tsugu.jp` を認証しているので、そのまま Resend を差出人にします。

| 項目 | 値 |
|---|---|
| Enable Custom SMTP | オン |
| Sender email | `noreply@fuku-tsugu.jp` |
| Sender name | `TsuguAi -継-` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | Resend の API キー（`re_` で始まるもの。`RESEND_API_KEY` と同じ値） |

保存したら、同じ画面の下にある **Rate limits** の
「Rate limit for sending emails」を **30 以上** にしておくと安心です
（既定の小さな値のままだと、ローンチ日に詰まります）。

> Host・Port・Username は Resend の Dashboard → SMTP でも確認できます。
> 値が違っていたら Resend の表示を優先してください。

---

## 2. 文面（Email Templates）

`Dashboard → Authentication → Email Templates`

4つあります。**波かっこの部分（`{{ .ConfirmationURL }}` など）は Supabase が
差し替える印なので、そのまま残してください。** 変えるのは日本語の部分だけです。

### 2-1. Confirm signup（登録の確認）— 経営者が最初に受け取る一通

**Subject**

```
【TsuguAi -継-】メールアドレスの確認をお願いします
```

**Message body**

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

### 2-2. Reset password（パスワードの再設定）

**Subject**

```
【TsuguAi -継-】パスワード再設定のご案内
```

**Message body**

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

### 2-3. Magic Link（リンクでログイン）

いまの画面はパスワードでログインする作りなので使われません。
念のため名乗りだけ揃えておきます。

**Subject**

```
【TsuguAi -継-】ログイン用のリンク
```

**Message body**

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

### 2-4. Change Email Address（メールアドレスの変更）

**Subject**

```
【TsuguAi -継-】メールアドレス変更の確認
```

**Message body**

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

## 3. 確かめかた

1. 使っていないメールアドレスで、いちど新規登録してみる
2. 届いたメールの **差出人が `TsuguAi -継-`**、件名が `【TsuguAi -継-】メールアドレスの確認をお願いします` になっている
3. ボタンを押して確認 → ログイン → 「担当パートナーの登録を待っています」の画面になる（担当が未登録なので、これが正しい）

3 まで通れば、経営者が最初に受け取る一通から、最後の便りまで、名乗りがすべて揃います。

---

## なぜ Auth のメールだけ別なのか

週の便り・毎朝のリマインド・月次レポートは、こちらで書いた Edge Function が
Resend を直接呼んでいるので、リポジトリの中で名乗りを決められます。
登録確認・パスワード再設定だけは **Supabase Auth が自分で送る**ため、
Dashboard で設定するしかありません。この文書は、その設定をリポジトリに
残しておくためのものです。次に屋号や差出人を変えるとき、ここを見れば
どこを触ればよいか分かります。
