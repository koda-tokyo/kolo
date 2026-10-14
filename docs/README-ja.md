# KoLo

KoLo は、Linux / macOS / Windows でサービスとして常駐する、統制されたエージェント ランタイムです。ターミナル、Web UI、CLI、メッセージング パイプ、そして他のエージェントは、いずれもそのクライアントとして動作します。

English: [README.md](../README.md)

- ドキュメント: https://kodasoken.com/kolo
- ソースとリリース: https://github.com/koda-tokyo/kolo
- 問い合わせとサポート: https://github.com/koda-tokyo/kolo/issues
- セキュリティ報告: security@kodasoken.com（[SECURITY.md](../SECURITY.md) を参照）
- 日本語ドキュメント: [クイックスタート](ja/QUICKSTART.md) · [セキュリティ概要](ja/security/SECURITY_OVERVIEW.md) · [プライバシー](ja/security/privacy.md) · [さくらのAI Engine](ja/providers/sakura.md)

## KoLo を選ぶ理由

- **常駐エージェントはセッションをまたいで働き続けます。** 識別名ごとに 1 つのゲートウェイ プロセスが OS のサービス マネージャ配下で動作し、セッションと作業領域を保持し、終了すれば OS が再起動します。ターミナルを閉じてもエージェントは止まりません。
- **統制はプロンプトではなくランタイムで強制されます。** スコープ付きペアリング（`observe` < `attach` < `admin` < `owner`）、端末の鍵に紐づく資格情報とローテーションするリフレッシュ トークン、ハッシュチェーンされた監査ログ（`kolo audit verify`）、登録済みファイルの改変を検知すると起動を拒否する起動時整合性ゲート。
- **記述された API と、そこから生成されたクライアント。** `GET /doc` で OpenAPI 3.1 文書を提供（43 操作、それぞれに認証種別と最小スコープを明記）。`@kodasoken/kolo-client` はこの文書から生成され、乖離があれば CI が失敗します。
- **1 つのセッションに複数のクライアント。** `attach` スコープを持つ資格情報なら、稼働中のセッションを一覧し、ターミナル、スクリプト、メッセージング パイプを接続できます。接続中のクライアント全員が同じイベント ストリームを受け取ります。
- **Code Mode と MCP。** エージェントは 1 本のスクリプトで多数のツールを 1 往復で呼び出せます。設定した MCP サーバーのツールは `mcp:<server>:<tool>` という名前で利用できます。
- **エージェント制御。** 実行ごとのステップ上限、同一呼び出しや進捗のないツール呼び出しを止めるループ検出、パスとコマンドに対するパーミッション グロブ、キャンセル可能なジョブ レジストリ。

## インストール

インストーラーのバンドルは Node.js ランタイムを同梱しています。npm から入れる場合は Node.js 22.12 以上が必要です。

Linux / macOS:

```bash
curl -fsSL https://kodasoken.com/kolo/install.sh | bash
```

Windows（PowerShell 7 または Windows PowerShell 5.1）:

```powershell
iwr -useb https://kodasoken.com/kolo/install.ps1 | iex
```

インストーラーは、GitHub Releases から OS と CPU に合ったリリース バンドルを選び、展開前に公開された `SHA256SUMS.txt` と SHA-256 を照合し、`~/.local/share/kolo/<version>`（Windows: `%LOCALAPPDATA%\KoLo\app\<version>`）に配置して `kolo` コマンドをリンクし、`kolo init --non-interactive` と `kolo service install` を実行し、1 回限りのペアリング招待コードを表示します。root や管理者権限では動作せず、github.com 以外からは何もダウンロードしません。両スクリプトはこのリポジトリの [`scripts/`](../scripts/) にあり、そのまま配信されています。フラグの一覧は [docs/install/index.md](install/index.md) を参照してください。

npm（グローバル、PATH 上に Node.js 22.12 以上が必要）:

```bash
npm install -g @kodasoken/kolo
kolo --version
```

バンドルのダウンロードとチェックサム検証（オフライン / 閉域環境）:

```bash
# ネットワークに接続できるマシンで kolo-<version>-<os>-<arch>.tar.gz（Windows は .zip）と
# SHA256SUMS.txt を https://github.com/koda-tokyo/kolo/releases/latest から取得
sha256sum -c --ignore-missing SHA256SUMS.txt
bash install.sh --bundle kolo-<version>-linux-x64.tar.gz --sums SHA256SUMS.txt
```

ソースから:

```bash
git clone https://github.com/koda-tokyo/kolo.git
cd kolo
pnpm install --frozen-lockfile
pnpm build
node kolo.mjs --version
```

`pnpm build && node scripts/bundle.mjs` を実行すると、インストーラーが使うものと同じバンドルが `release/` に生成されます（[docs/PACKAGING.md](PACKAGING.md)）。

## 初回起動

新しく使い始める方が覚える必要があるコマンドは `kolo init` だけです。状態ディレクトリ、設定、ゲートウェイ トークンを作成し、診断を実行して、次に打つコマンドを表示します。

```bash
kolo init --name alice --lang ja
```

```
state      /home/alice/.kolo
config     /home/alice/.kolo/kolo.json
token      /home/alice/.kolo/secrets/gateway.token (created, 0600)
workspace  /home/alice/.kolo/workspace
identity   alice
bind       loopback
port       18789
provider   not chosen (kolo onboard, or kolo secrets)
doctor     ok

next:
  kolo service install --id alice  run the gateway under the OS service manager
  kolo health                      one status line from the gateway
  kolo onboard                     choose a model provider
  kolo pair invite --scope attach  invitation for a second device or terminal
  kolo tui                         talk to the agent
```

続けて:

```bash
kolo service install --id alice     # systemd (Linux) / launchd (macOS) / タスク スケジューラ (Windows)
kolo health                         # 稼働中のゲートウェイから 1 行のステータス
kolo pair invite --scope attach     # 1 回限りのコード (kpi_...) を表示。保存されるのはハッシュのみ
kolo attach --list                  # この資格情報で見えるセッション
kolo tui                            # このターミナルでエージェントと対話
```

プロンプトなしで実行する場合: `kolo init --non-interactive --name alice --bind loopback --provider sakura`（トークンは `SAKURA_API_KEY` から読み取ります）。日本語メッセージは `--lang ja` または `KOLO_LANG=ja` で指定します。ゲートウェイが起動していなければ `kolo health` がその旨と起動コマンドを表示します。

終了コードは全コマンド共通です: `0` 成功、`1` エラー、`2` 使い方の誤り、`3` ゲートウェイに到達不可、`4` 認証失敗。

## 主な概念

| 用語 | 意味 |
|---|---|
| 識別名 (Identity) | 常駐エージェント 1 体の名前（`alice`、`ops-bot`）。識別名ごとに独立したサービス、状態ディレクトリ、ポートを持ちます。使える文字は `a-z`、`0-9`、`-`、`_` で 1〜32 文字。 |
| `KOLO_HOME` | その識別名が所有するすべてを収める 1 つのディレクトリ。`~/.kolo`（Windows: `%LOCALAPPDATA%\KoLo`）。2 つ目以降の識別名は `~/.kolo-<id>`。プログラム本体以外はここ以外に書き込みません。 |
| ゲートウェイ | 常駐プロセス。既定ではループバックにのみバインドし、HTTP と WebSocket を提供し、エージェントを実行し、セッションを保持し、監査ログを書きます。 |
| セッション | エージェントが参加している会話（`agent:alice:main`）。セッションはゲートウェイ内に存在し、ターミナル、パイプ、他のエージェントがそこに接続します。 |
| 招待 (Invitation) | 1 回限りのペアリング コード（`kpi_...`）。スコープ、有効期限（既定 10 分）、任意でセッションの許可リストを持ちます。作成者が持つ以上の権限は決して付与しません。 |
| 端末 (Device) | ペアリング済みのクライアント。固有の Ed25519 鍵と、`KOLO_HOME/secrets/devices/` 配下の資格情報ファイルを持ちます。短命のアクセス トークン（既定 1 時間）とローテーションするリフレッシュ トークン（既定 30 日）。 |
| ジョブ (Job) | エージェントの 1 回の実行。queued → running → 終了状態。`/api/jobs` で一覧とキャンセルができ、キャンセルは監査されます。 |
| プラグイン | プロセス内で読み込まれる拡張。`KoLo.plugin.json` マニフェストと設定用 JSON スキーマを同梱します。チャネル、プロバイダー、ツール、同梱の運用プラグインはすべてプラグインです。 |
| MCP サーバー | ゲートウェイが接続する外部ツール サーバー（`kolo mcp add`）。そのツールは `mcp:<server>:<tool>` として現れ、実行系のツールは名前で許可しない限り隠されます。 |
| Code Mode | `code_mode_run` ツール。モデルが 1 本のスクリプトを書き、`tools.*` 経由で多数のツールを呼び、値を返します。N 往復の代わりに 1 往復、既定 60 秒の実時間上限付き。 |

`KOLO_HOME` の構成:

```
kolo.json                 設定（秘密情報は名前で参照し、ここには保存しない）
secrets/                  gateway.token (0600)、devices/<fingerprint>.json、credentials.json（ハッシュのみ）
agents/<id>/sessions/     会話の記録。アップロードされることはない
workspace/                エージェントの作業ディレクトリと指示ファイル
audit/                    ハッシュチェーンされた監査ログ。月ごとに 1 ファイル
logs/                     日ごとのゲートウェイ ログ。秘密情報はマスク済み
run/                      gateway.lock、jobs.json
service/                  サービス定義と直近のインストール時のポート
support/                  kolo support が書き出すマスク済みバンドル
```

スコープ（すべての HTTP ルートと WebSocket メソッドで強制されます）:

| スコープ | できること |
|---|---|
| `observe` | 読み取り: ヘルス、メトリクス、一覧、履歴、`/api/pair/me` |
| `attach` | observe に加えてセッションの操作: チャット、エージェント ターン、`/tools/invoke`、`/v1/*`、Code Mode |
| `admin` | attach に加えてゲートウェイの管理: 設定、cron、ペアリング、プラグインの再読み込み |
| `owner` | ゲートウェイ トークン ファイル（`KOLO_HOME/secrets/gateway.token`）。ペアリングでは決して付与されない |

最小スコープに満たない資格情報は HTTP では `403`、WebSocket では `missing scope: <scope>` を受け取ります。失効済みのリフレッシュ トークンが再利用されると、その資格情報ファミリー全体が取り消されます。`gateway.pairing.reconsentDays`（既定 90 日）を超えた端末は再ペアリングが必要です。詳細: [docs/cli/pair.md](cli/pair.md)、[docs/cli/attach.md](cli/attach.md)。

## セキュリティ

セキュリティ質問票への回答は [セキュリティ概要](ja/security/SECURITY_OVERVIEW.md)、データの取り扱いは [プライバシー](ja/security/privacy.md) を参照してください。脆弱性の報告は security@kodasoken.com へ。手順と目標期間は [SECURITY.md](../SECURITY.md) にあります。

マシンの外に出る通信は、いずれも設定した後にのみ発生します:

| 通信 | 宛先 | 止め方 |
|---|---|---|
| モデルへのリクエスト | 設定したプロバイダー | `local` プロファイル |
| メッセージング チャネル | そのチャネルのサービス | チャネルを有効にしない |
| 更新確認（バージョン情報のみ） | パッケージ レジストリ（npm インストールのみ） | `update.checkOnStart: false` |
| ローカル ネットワークへの告知 | mDNS 経由で LAN | `gateway.discovery.mdns.mode: "off"` |
| インストーラー | github.com（インストール時のみ） | `--bundle` によるオフライン インストール |

テレメトリ、アナリティクス、クラッシュ レポートはありません。ゲートウェイは実行時にベンダーへ接続しません。サポート バンドルはローカルに書き出され、チケットに添付した場合にだけ外に出ます。

検証できる性質:

```bash
kolo audit verify            # ハッシュチェーンを再走査。最初の切れ目で終了コード 1
kolo integrity status        # 登録済みファイルすべてのダイジェストを照合。不一致なら終了コード 3
kolo pair devices            # 資格情報を持つ端末、スコープ、最終アクセス
kolo secrets list            # 名前とバックエンドのみ。値は決して表示しない
```

完全な削除:

```bash
kolo uninstall --all --yes --dry-run      # サービス、状態ディレクトリ、作業領域を一覧表示。削除はしない
kolo uninstall --all --yes
rm -rf ~/.local/share/kolo ~/.local/bin/kolo    # プログラム本体 (Windows: %LOCALAPPDATA%\KoLo)
```

これらのパス以外には何も残りません。削除したゲートウェイが発行した資格情報は無効になります。

## この先

設定、CLI リファレンス、HTTP / WebSocket API、運用、プラグイン、互換性、ライセンスと商標、コントリビューション、サポートと評価については、英語版 [README.md](../README.md) の後半を参照してください。ライセンスの構成（MIT / FSL-1.1-Apache-2.0 / プロプライエタリ）は [LICENSING.md](../LICENSING.md)、商標は [TRADEMARKS.md](../TRADEMARKS.md)、評価ライセンスは [EVALUATION_LICENSE.md](EVALUATION_LICENSE.md) にあります。
