# 応物単位くん (Tanikun)

Tanikun は大学の単位と卒業要件を計画するローカルファーストの Web アプリです。
MoonBit で実装しています。

Phase 1 は完了し、純粋なドメインモデル、単位集計、要件評価を実装しました。
Phase 2 では時間割プランナーの UI を実装しました。契約と結果は
[docs/PHASE_2.md](docs/PHASE_2.md) と
[docs/PHASE_2_RESULTS.md](docs/PHASE_2_RESULTS.md) にあります。永続化と同期は
後続の Phase で対応します。

**English:** [README.md](README.md)

## 状態

- Phase 0: ビルド、Worker、ブラウザテストの基盤。記録は
  [docs/PHASE_0.md](docs/PHASE_0.md) にあり、これは履歴です。
- Phase 1: 完了。契約は [docs/PHASE_1.md](docs/PHASE_1.md)、
  結果は [docs/PHASE_1_RESULTS.md](docs/PHASE_1_RESULTS.md) にあります。
- Phase 2: 完了。プランナー UI の契約は
  [docs/PHASE_2.md](docs/PHASE_2.md)、結果は
  [docs/PHASE_2_RESULTS.md](docs/PHASE_2_RESULTS.md) にあります。
- 後の Phase: Phase 3 の永続化と同期。未着手です。

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

`just test` には MoonBit のツールチェーンが必要です。Web のツール、ブラウザ、
Worker、D1 のテストには `pnpm install` が必要です。`just` には `test-css`、
`test-browser`、`test-worker`、`test-automerge`、`test-d1` もあります。

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
- [Phase 2 の結果](docs/PHASE_2_RESULTS.md)
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
