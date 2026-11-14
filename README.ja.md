# 応物単位くん (Tanikun)

Tanikun は大学の単位と卒業要件を計画するローカルファーストの Web アプリです。
MoonBit で実装しています。

Phase 1 は完了し、純粋なドメインモデル、単位集計、要件評価を実装しました。
Phase 2 では時間割プランナーの UI を実装しました。契約と結果は
[docs/PHASE_2.md](docs/PHASE_2.md) と
[docs/PHASE_2_RESULTS.md](docs/PHASE_2_RESULTS.md) にあります。Phase 3 では
ローカル永続化と Automerge のレプリカ間の収束を実装しました。結果は
[docs/PHASE_3_RESULTS.md](docs/PHASE_3_RESULTS.md) にあります。Phase 4 では
Worker と D1 を使った HTTP 差分同期を追加し、ローカル開発用の認証と 2 つの
ブラウザ間の収束テストを用意しました。実装と証拠は
[docs/PHASE_4_RESULTS.md](docs/PHASE_4_RESULTS.md) にあります。Phase 4 は
ローカル開発専用で、本番認証、E2EE、ピアの自動検出、スナップショットによる
変更履歴の圧縮、本番環境へのデプロイは対象外です。

**English:** [README.md](README.md)

## 状態

- Phase 0: ビルド、Worker、ブラウザテストの基盤。記録は
  [docs/PHASE_0.md](docs/PHASE_0.md) にあり、これは履歴です。
- Phase 1: 完了。契約は [docs/PHASE_1.md](docs/PHASE_1.md)、
  結果は [docs/PHASE_1_RESULTS.md](docs/PHASE_1_RESULTS.md) にあります。
- Phase 2: 完了。プランナー UI の契約は
  [docs/PHASE_2.md](docs/PHASE_2.md)、結果は
  [docs/PHASE_2_RESULTS.md](docs/PHASE_2_RESULTS.md) にあります。
- Phase 3: 完了。Automerge と IndexedDB によるローカル永続化、再読み込み後の復元、
  レプリカ間の収束を実装しました。結果は
  [docs/PHASE_3_RESULTS.md](docs/PHASE_3_RESULTS.md)、保存仕様は
  [ADR-0012](docs/adr/0012-automerge-planner-document.md) にあります。
- Phase 4: 実装と証拠は基準コミットまで完了しています。Worker と D1 による
  HTTP 差分同期、ローカル開発用認証、同期状態の表示、2 つのブラウザの障害テストを
  実装しました。テスト件数とマイルストーンを終了する条件は
  [docs/PHASE_4_RESULTS.md](docs/PHASE_4_RESULTS.md) にあります。機能は
  ローカル開発専用です。
- Phase 5: ローカルのパスキーセッションとアカウント分離を実装しています。
  契約は [docs/PHASE_5.md](docs/PHASE_5.md)、範囲を限定した実セッションの
  証跡は [docs/PHASE_5_SESSION_PROOF.md](docs/PHASE_5_SESSION_PROOF.md) です。
  物理デバイス、スクリーンリーダー、公開デプロイ、Phase 5 の closeout は
  未完了です。

## 構成

- MoonBit（Rabbita / Warren）
- Cloudflare Workers
- Tailwind CSS v4
- Nix（MoonBit とシステムツールの固定）
- fnm と corepack（Node.js 24.22.1 と pnpm 12.9.0）

## セットアップ

flake に対応した Nix が必要です。direnv は任意です。

初回のシェル起動時に、fnm が `.node-version` の Node.js 24.22.1 を取得します。
corepack が固定版の pnpm を提供するため、Node.js をグローバルにインストールする
必要はありません。CI は `actions/setup-node` を使い、fnm のフックを省略します。

```sh
git clone git@github.com:beso1225/tanikun.git
cd tanikun
direnv allow            # または nix develop

just setup-web          # Warren を導入（初回のみ・ネットワーク必要）
pnpm install --frozen-lockfile

just dev-web            # http://127.0.0.1:4300
just dev-api            # http://127.0.0.1:8787/api/health
```

`dev-web` と `dev-api` は別々のターミナルで起動してください。

## よく使うコマンド

```sh
just test               # ビルドと MoonBit・export テスト
just lint               # 整形、型、リポジトリの lint
just fmt                # 利用可能な formatter を適用
nix flake check path:.  # pure domain を含む sandbox チェック
```

`just test` には MoonBit のツールチェーンと、Automerge の文書テストに使うパッケージが
必要です。`pnpm install --frozen-lockfile` でインストールしてください。
Web のツール、ブラウザ、Worker、D1 のテストにもこれらのパッケージが必要です。
`just` には `test-css`、`test-browser`、Phase 4 の dev-bearer 向け
`test-sync`、Phase 5 の実セッション証跡向け `test-session-proof`、
`test-worker`、`test-automerge`、`test-d1` もあります。

Mutation testing は任意で、CI の必須チェックではありません。

```sh
nix develop
just setup-mutation     # 初回のみ・ネットワーク必要
just mutate
```

baseline と accepted mutant は [docs/MUTATION.md](docs/MUTATION.md) にあります。

## ドキュメント

- [ドキュメント一覧](docs/README.md)
- [Phase 1 の契約](docs/PHASE_1.md)
- [Phase 1 の結果](docs/PHASE_1_RESULTS.md)
- [Phase 2 の契約](docs/PHASE_2.md)
- [Phase 2 の結果](docs/PHASE_2_RESULTS.md)
- [Phase 3 の結果](docs/PHASE_3_RESULTS.md)
- [Phase 4 の結果](docs/PHASE_4_RESULTS.md)
- [Phase 5 の契約](docs/PHASE_5.md)
- [Phase 5 の実セッション証跡](docs/PHASE_5_SESSION_PROOF.md)
- [Mutation testing](docs/MUTATION.md)
- [用語集](GLOSSARY.md)
- [Architecture decision records](docs/adr/README.md)
- [Phase 0 の記録](docs/PHASE_0.md)、[初期設計](docs/INITIAL_DESIGN.md)、
  [技術レビュー](docs/TECH_REVIEW.md) は履歴です。

## 開発の進め方

変更は pull request 経由で取り込みます。`main` では `linux` と `lint` の CI
チェックが必須です。直接 push、force push、ブランチ削除は禁止されています。

## ライセンス

[MIT](LICENSE)
