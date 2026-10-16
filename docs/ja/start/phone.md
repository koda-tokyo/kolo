---
summary: "インストール直後から5分で、常駐エージェントがスマートフォンで応答するまで：WhatsApp、Telegram、LINE、スマートフォンのブラウザー"
read_when:
  - Kurahiをインストールした直後で、スマートフォンから話しかけたい
  - WhatsApp、Telegram、LINE、ブラウザーのどれを使うか決めたい
  - チャネルのオーナー登録を解除または登録し直したい
title: "スマートフォンをつなぐ"
---

# スマートフォンをつなぐ (5分)

English: [Connect your phone](/start/phone)

`kurahi init` の最後の質問は **Connect your phone (スマートフォンをつなぐ)** で、QRコードを表示して終わります。QRを読み取り、メッセージを1通送ると、常駐エージェントがそこで応答します。同じ手順はいつでも `kurahi connect <チャネル>` で実行できます。

```bash
kurahi init                       # 最後の質問: Connect your phone
kurahi connect telegram           # whatsapp、line、web も可
kurahi connect --list             # どのチャネルに誰がオーナーとして登録されているか
kurahi connect --unbind telegram  # そのオーナー登録を解除
```

## 5分の流れ

| 時間   | 操作                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-2分 | インストール：`curl -fsSL https://kodasoken.com/kurahi/install.sh \| bash` (Windows: `iwr -useb https://kodasoken.com/kurahi/install.ps1 \| iex`) |
| 2-3分 | `kurahi init`: 識別名、ゲートウェイに接続できる範囲、プロバイダーのトークン                                                                       |
| 3-4分 | **Connect your phone** でチャネルを選び、2〜3個の質問に答える                                                                                    |
| 4-5分 | スマートフォンでQRを読み取り、最初のメッセージを送る。常駐エージェントが応答する                                                                |

最初のメッセージを受け取るには、ゲートウェイが動いている必要があります。インストーラーはサービスとして登録します。`kurahi init` を手動で実行した場合は `kurahi service install` (または別のターミナルで `kurahi gateway`)で起動してください。コードの有効期限は10分なので、QR表示のあとで起動しても間に合います。

## どのチャネルを選ぶか

| チャネル                   | 必要なもの                                                         | オーナーの確認方法                     | 向いている用途                       |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------- | ------------------------------------ |
| Telegram                   | Telegramアカウントと、BotFatherで作るボット1つ                 | 1回限りのコード付きの最初の `/start`  | いちばん速い                         |
| WhatsApp                   | スマートフォンのWhatsAppアプリ                                   | リンク済みデバイスのQRを読み取ること | 普段使いのアプリで話したい           |
| LINE                       | LINE公式アカウント (Messaging API)と、Webhook用の公開HTTPS URL | 1回限りのコード付きの最初のメッセージ | 日本のチーム                         |
| スマートフォンのブラウザー | 同じネットワークまたはtailnetからHTTPSで届くゲートウェイ       | 1回限りのペアリング招待               | メッセージングのアカウントなしで使う |

## Telegram

1. `kurahi connect telegram` を実行します (または `kurahi init` でTelegramを選びます)。
2. スマートフォンでhttps://t.me/BotFatherを開き、`/newbot` を送り、名前と `bot` で終わるユーザー名を決め、BotFatherが返すトークンを貼り付けます。トークンはシークレットストアに保存され、設定には `{"$secret": "channel.telegram.botToken"}` という参照だけが残ります。
3. QRを読み取ります。`https://t.me/<ボット>?start=KOLO-XXXXXXXX` が開くので **開始** を押します。
4. このコード付きの最初の `/start` で、あなたのTelegramユーザーがチャネルのオーナーとして登録され、ボットが登録完了を返信します。あとは何を書いても常駐エージェントが応答します。

プロンプトなし：`TELEGRAM_BOT_TOKEN=<トークン> kurahi init --non-interactive --phone telegram`、または標準入力にトークンを渡して `kurahi connect telegram --stdin --no-wait`。

## WhatsApp

1. `kurahi connect whatsapp` を実行します。
2. スマートフォンでWhatsApp > 設定 > リンク済みデバイス > デバイスをリンクを開き、ターミナルのQRを読み取ります。コードは約20秒ごとに更新され、そのたびに新しいQRが表示されます。
3. 読み取りによって番号の所有が確認されるので、リンクした番号がそのままオーナーとして登録されます。
4. WhatsAppで **自分にメッセージ** を選んでメッセージを書きます。最初の1通には「接続しました」という1行の返信が付き、そのあとに常駐エージェントの応答が届きます。

すでにセッションがある場合にリンクし直すには `kurahi connect whatsapp --force` を使います。

## LINE

1. LINE Developersコンソール (https://developers.line.biz/console/)でMessaging APIチャネルを作成し、**チャネルシークレット** をコピーし、長期の **チャネルアクセストークン** を発行します。
2. `kurahi connect line` を実行し、両方を貼り付けます。値はシークレットストアに保存され、`kolo.json`、コマンドライン引数、ログには残りません。
3. Webhookを登録します。LINEは公開されたHTTPSのURLにしかメッセージを届けません：`https://<公開ホスト>/line/webhook` をゲートウェイのポートへ転送します。Kurahiがトンネルを自動で作ることはありません。次のいずれかを使います。
   - tailnetからの公開ファネル ([Tailscale](/gateway/tailscale) を参照)
   - 自分で管理するホスト上の、TLS証明書付きリバースプロキシ
   - すでに運用しているトンネルサービス

   そのあとコンソールで **Webhookの利用** を有効にします。詳細：[LINE](/channels/line)。

4. QR (ボットの友だち追加URL)を読み取ってボットを友だちに追加し、ターミナルに表示された `KOLO-XXXXXXXX` を最初のメッセージとして送ります。これで、あなたのLINEユーザーがオーナーとして登録されます。

## スマートフォンのブラウザー

`kurahi connect web` は `https://<アドレス>:<ポート>/#pair=<コード>` のQRを表示します。1回限りのペアリング招待 (スコープ `attach`、10分、1回のみ)です。ダッシュボードが開くと、アドレスバーからコードを取り除き、ブラウザー内に保存したデバイス鍵で引き換え、資格情報を自動で更新しながらサインインした状態を保ちます。コードはURLのフラグメントに入っているため、ブラウザーがサーバーへ送ることはありません。

スマートフォンからゲートウェイに届く場合にだけ提示されます。これは明示的な選択です。

- `kurahi init --bind lan` (または `tailnet`、`custom`)で `gateway.bind` と `gateway.remote.enabled` が設定されます。`loopback` (既定)の場合は、QRの代わりに理由と有効にする方法を表示します。
- ブラウザーがデバイス鍵を保持できるのはHTTPSのページだけなので、TLSを有効にします：`kurahi config set gateway.tls.enabled true` (自己署名証明書が生成され、スマートフォンで一度だけ信頼の確認があります)。そのあとゲートウェイを再起動します。

未使用の招待は `kurahi pair revoke <招待 id>` で取り消せます。ペアリング済みのスマートフォンは `kurahi pair devices` で確認し、`kurahi pair revoke <フィンガープリント>` で外します。

## オーナー登録

- 1回限りのコード (`KOLO-` と8文字)の有効期限は **10分**、使えるのは **1回** だけです。保存されるのはハッシュのみです (`<KOLO_HOME>/channels/owner-codes.json`、モード0600)。新しいコードを発行すると、そのチャネルの未使用のコードは取り消されます。
- 登録すると `channels.<チャネル>.identities["<送信者 id>"] = "owner"` (アカウント別なら `channels.<チャネル>.accounts.<id>.identities`)が書き込まれ、送信者がチャネルのペアリング許可リストに追加されます。チャネルにidentitiesが設定されると、そこに載っている送信者だけがロールを持ちます ([Channel residents](/channels/README) を参照)。
- すべての操作は監査ログに記録されます：`channel.owner_code.issued`、`channel.owner_code.claim`、`channel.owner_bound`、`channel.owner_unbound`。`kurahi audit verify` で確認できます。
- `kurahi connect --unbind <チャネル>` は、登録で追加したもの (identitiesのキーと許可リストの項目)だけを取り除き、未使用のコードを取り消します。

## 返信と自発的な送信

スマートフォンから常駐エージェントと話すのは会話です。チャネルが受け入れた送信者からのメッセージには、`channels.delivery.replyWindowMs` (既定24時間)の間、常駐エージェントはいつでも **返信** できます。自分から送るものは **自発的な送信 (proactive)** として `channels.delivery.policy` に従います。既定 (`human-triggered`)では自動の自発的送信は拒否され、デッドレターに記録されます。`replies-only` はすべての自発的送信を拒否し、`allow-automated` はデーモンやcronからの送信も許可します。[Delivery guarantees](/channels/README#delivery-guarantees) を参照してください。

## うまくいかないとき

- **最初のメッセージに応答がない**: ゲートウェイは動いていますか (`kurahi health`)。コードの期限が切れていませんか (`kurahi connect <チャネル>` で新しいコードを表示)。LINEの場合はコンソールのWebhook設定を確認してください。
- **「このコードは期限切れか使用済みです」**: `kurahi connect <チャネル>` をもう一度実行します。
- **ブラウザーがHTTPのページだと表示する**: `gateway.tls` を有効にして、新しいコードを読み取ります。
- **別の人がオーナーとして登録された**: `kurahi connect --unbind <チャネル>` を実行してから、つなぎ直します。
