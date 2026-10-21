# 応物単位くん (Tanikun)

応用物理学科向けに、単位や卒業要件を計画するローカルファーストWebアプリです。
現在は開発初期（Phase 0）で、ビルド・Worker・ブラウザテストの基盤が動く状態です。

**English:** [README.md](README.md)

## 構成

- MoonBit（Rabbita / Warren）
- Cloudflare Workers
- Tailwind CSS v4
- Nix（固定ツールチェーン）と pnpm

## クイックスタート

必要なもの: flake対応のNix。direnvは任意です。

```sh
git clone git@github.com:beso1225/tanikun.git
cd tanikun
direnv allow            # または nix develop path:.

just setup-web          # Warrenを導入（初回のみ・ネットワーク必要）
pnpm install --frozen-lockfile

just dev-web            # http://127.0.0.1:4300
just dev-api            # http://127.0.0.1:8787/api/health
```

`dev-web` と `dev-api` は別々のターミナルで起動してください。

## テスト

```sh
just check
just test
just test-css
just test-browser
just test-worker
just test-automerge
just test-d1
```

`test-browser` は `just setup-web`、`test-worker` / `test-automerge` /
`test-d1` は `pnpm install` が前提です。

## ドキュメント

- [Phase 0の計画と検証記録](docs/PHASE_0.md)
- [初期設計](docs/INITIAL_DESIGN.md)
- [用語集](GLOSSARY.md)

## ライセンス

[MIT](LICENSE)
