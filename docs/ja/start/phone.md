---
summary: "インストール直後から 5 分で、常駐エージェントがスマートフォンで応答するまで: WhatsApp、Telegram、LINE、スマートフォンのブラウザー"
read_when:
  - KoLo をインストールした直後で、スマートフォンから話しかけたい
  - WhatsApp、Telegram、LINE、ブラウザーのどれを使うか決めたい
  - チャネルのオーナー登録を解除または登録し直したい
title: "スマートフォンをつなぐ"
---

# スマートフォンをつなぐ (5 分)

English: [Connect your phone](/start/phone)

`kolo init` の最後の質問は **Connect your phone (スマートフォンをつなぐ)** で、QR コードを表示して終わります。QR を読み取り、メッセージを 1 通送ると、常駐エージェントがそこで応答します。同じ手順はいつでも `kolo connect <チャネル>` で実行できます。

```bash
kolo init                       # 最後の質問: Connect your phone
kolo connect telegram           # whatsapp、line、web も可
kolo connect --list             # どのチャネルに誰がオーナーとして登録されているか
kolo connect --unbind telegram  # そのオーナー登録を解除
```

## 5 分の流れ

| 時間   | 操作                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-2 分 | インストール: `curl -fsSL https://kodasoken.com/kolo/install.sh \| bash` (Windows: `iwr -useb https://kodasoken.com/kolo/install.ps1 \| iex`) |
| 2-3 分 | `kolo init`: 識別名、ゲートウェイに接続できる範囲、プロバイダーのトークン                                                                     |
| 3-4 分 | **Connect your phone** でチャネルを選び、2〜3 個の質問に答える                                                                                |
| 4-5 分 | スマートフォンで QR を読み取り、最初のメッセージを送る。常駐エージェントが応答する                                                            |

最初のメッセージを受け取るには、ゲートウェイが動いている必要があります。インストーラーはサービスとして登録します。`kolo init` を手動で実行した場合は `kolo service install` (または別のターミナルで `kolo gateway`) で起動してください。コードの有効期限は 10 分なので、QR 表示のあとで起動しても間に合います。

## どのチャネルを選ぶか

| チャネル                   | 必要なもの                                                         | オーナーの確認方法                     | 向いている用途                       |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------- | ------------------------------------ |
| Telegram                   | Telegram アカウントと、BotFather で作るボット 1 つ                 | 1 回限りのコード付きの最初の `/start`  | いちばん速い                         |
| WhatsApp                   | スマートフォンの WhatsApp アプリ                                   | リンク済みデバイスの QR を読み取ること | 普段使いのアプリで話したい           |
| LINE                       | LINE 公式アカウント (Messaging API) と、Webhook 用の公開 HTTPS URL | 1 回限りのコード付きの最初のメッセージ | 日本のチーム                         |
| スマートフォンのブラウザー | 同じネットワークまたは tailnet から HTTPS で届くゲートウェイ       | 1 回限りのペアリング招待               | メッセージングのアカウントなしで使う |

## Telegram

1. `kolo connect telegram` を実行します (または `kolo init` で Telegram を選びます)。
2. スマートフォンで https://t.me/BotFather を開き、`/newbot` を送り、名前と `bot` で終わるユーザー名を決め、BotFather が返すトークンを貼り付けます。トークンはシークレットストアに保存され、設定には `{"$secret": "channel.telegram.botToken"}` という参照だけが残ります。
3. QR を読み取ります。`https://t.me/<ボット>?start=KOLO-XXXXXXXX` が開くので **開始** を押します。
4. このコード付きの最初の `/start` で、あなたの Telegram ユーザーがチャネルのオーナーとして登録され、ボットが登録完了を返信します。あとは何を書いても常駐エージェントが応答します。

プロンプトなし: `TELEGRAM_BOT_TOKEN=<トークン> kolo init --non-interactive --phone telegram`、または標準入力にトークンを渡して `kolo connect telegram --stdin --no-wait`。

## WhatsApp

1. `kolo connect whatsapp` を実行します。
2. スマートフォンで WhatsApp > 設定 > リンク済みデバイス > デバイスをリンク を開き、ターミナルの QR を読み取ります。コードは約 20 秒ごとに更新され、そのたびに新しい QR が表示されます。
3. 読み取りによって番号の所有が確認されるので、リンクした番号がそのままオーナーとして登録されます。
4. WhatsApp で **自分にメッセージ** を選んでメッセージを書きます。最初の 1 通には「接続しました」という 1 行の返信が付き、そのあとに常駐エージェントの応答が届きます。

すでにセッションがある場合にリンクし直すには `kolo connect whatsapp --force` を使います。

## LINE

1. LINE Developers コンソール (https://developers.line.biz/console/) で Messaging API チャネルを作成し、**チャネルシークレット** をコピーし、長期の **チャネルアクセストークン** を発行します。
2. `kolo connect line` を実行し、両方を貼り付けます。値はシークレットストアに保存され、`kolo.json`、コマンドライン引数、ログには残りません。
3. Webhook を登録します。LINE は公開された HTTPS の URL にしかメッセージを届けません: `https://<公開ホスト>/line/webhook` をゲートウェイのポートへ転送します。KoLo がトンネルを自動で作ることはありません。次のいずれかを使います。
   - tailnet からの公開ファネル ([Tailscale](/gateway/tailscale) を参照)
   - 自分で管理するホスト上の、TLS 証明書付きリバースプロキシ
   - すでに運用しているトンネルサービス

   そのあとコンソールで **Webhook の利用** を有効にします。詳細: [LINE](/channels/line)。

4. QR (ボットの友だち追加 URL) を読み取ってボットを友だちに追加し、ターミナルに表示された `KOLO-XXXXXXXX` を最初のメッセージとして送ります。これで、あなたの LINE ユーザーがオーナーとして登録されます。

## スマートフォンのブラウザー

`kolo connect web` は `https://<アドレス>:<ポート>/#pair=<コード>` の QR を表示します。1 回限りのペアリング招待 (スコープ `attach`、10 分、1 回のみ) です。ダッシュボードが開くと、アドレスバーからコードを取り除き、ブラウザー内に保存したデバイス鍵で引き換え、資格情報を自動で更新しながらサインインした状態を保ちます。コードは URL のフラグメントに入っているため、ブラウザーがサーバーへ送ることはありません。

スマートフォンからゲートウェイに届く場合にだけ提示されます。これは明示的な選択です。

- `kolo init --bind lan` (または `tailnet`、`custom`) で `gateway.bind` と `gateway.remote.enabled` が設定されます。`loopback` (既定) の場合は、QR の代わりに理由と有効にする方法を表示します。
- ブラウザーがデバイス鍵を保持できるのは HTTPS のページだけなので、TLS を有効にします: `kolo config set gateway.tls.enabled true` (自己署名証明書が生成され、スマートフォンで一度だけ信頼の確認があります)。そのあとゲートウェイを再起動します。

未使用の招待は `kolo pair revoke <招待 id>` で取り消せます。ペアリング済みのスマートフォンは `kolo pair devices` で確認し、`kolo pair revoke <フィンガープリント>` で外します。

## オーナー登録

- 1 回限りのコード (`KOLO-` と 8 文字) の有効期限は **10 分**、使えるのは **1 回** だけです。保存されるのはハッシュのみです (`<KOLO_HOME>/channels/owner-codes.json`、モード 0600)。新しいコードを発行すると、そのチャネルの未使用のコードは取り消されます。
- 登録すると `channels.<チャネル>.identities["<送信者 id>"] = "owner"` (アカウント別なら `channels.<チャネル>.accounts.<id>.identities`) が書き込まれ、送信者がチャネルのペアリング許可リストに追加されます。チャネルに identities が設定されると、そこに載っている送信者だけがロールを持ちます ([Channel residents](/channels/README) を参照)。
- すべての操作は監査ログに記録されます: `channel.owner_code.issued`、`channel.owner_code.claim`、`channel.owner_bound`、`channel.owner_unbound`。`kolo audit verify` で確認できます。
- `kolo connect --unbind <チャネル>` は、登録で追加したもの (identities のキーと許可リストの項目) だけを取り除き、未使用のコードを取り消します。

## 返信と自発的な送信

スマートフォンから常駐エージェントと話すのは会話です。チャネルが受け入れた送信者からのメッセージには、`channels.delivery.replyWindowMs` (既定 24 時間) の間、常駐エージェントはいつでも **返信** できます。自分から送るものは **自発的な送信 (proactive)** として `channels.delivery.policy` に従います。既定 (`human-triggered`) では自動の自発的送信は拒否され、デッドレターに記録されます。`replies-only` はすべての自発的送信を拒否し、`allow-automated` はデーモンや cron からの送信も許可します。[Delivery guarantees](/channels/README#delivery-guarantees) を参照してください。

## うまくいかないとき

- **最初のメッセージに応答がない**: ゲートウェイは動いていますか (`kolo health`)。コードの期限が切れていませんか (`kolo connect <チャネル>` で新しいコードを表示)。LINE の場合はコンソールの Webhook 設定を確認してください。
- **「このコードは期限切れか使用済みです」**: `kolo connect <チャネル>` をもう一度実行します。
- **ブラウザーが HTTP のページだと表示する**: `gateway.tls` を有効にして、新しいコードを読み取ります。
- **別の人がオーナーとして登録された**: `kolo connect --unbind <チャネル>` を実行してから、つなぎ直します。
