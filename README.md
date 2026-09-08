# Block Drop

ブラウザで遊べる落ちものパズルゲーム。URL を開くだけで、PC でもスマートフォンでも遊べます。自己ベストはブラウザに保存されます。

## できること

- 7種のブロックが落ちてきて、横一列そろうと消える
- 壁ぎわ・床ぎわでも回転が成立する（SRS の壁蹴り）
- 落下位置の予告（ゴースト）、次のブロック表示（ネクスト）、1つだけ退避できるホールド
- 10ライン消すごとにレベルが上がり、落下が速くなる
- 自己ベストをブラウザに保存（サーバー不要）
- キーボードとタッチの両対応

## 操作

**PC（キーボード）**

| キー | 操作 |
|---|---|
| ← → | 左右に移動 |
| ↑ | 右回転 |
| Z | 左回転 |
| ↓ | ソフトドロップ（押している間だけ速く落ちる） |
| Space | ハードドロップ（一気に着地） |
| C | ホールド |
| P | ポーズ / 再開 |
| R | リスタート |

**スマートフォン（タッチ）**

| 操作 | 動作 |
|---|---|
| 横にドラッグ | 指に追従して左右に移動 |
| タップ | 右回転 |
| 下にすばやくフリック | ハードドロップ |
| 下にゆっくりドラッグ | ソフトドロップ |
| HOLD / PAUSE / RESTART ボタン | ホールド / ポーズ / リスタート |

## 動作環境

- Node.js 22 以降
- pnpm 11 以降

遊ぶだけならブラウザだけで足ります（下記の「公開URLで遊ぶ」を参照）。以下は手元で開発・実行する場合の手順です。

## セットアップ

```bash
git clone git@github.com:jyasukawa/block-drop-game.git
cd block-drop-game
pnpm install
```

## 起動

```bash
pnpm dev
```

起動すると `http://localhost:5173/` が表示されるので、ブラウザで開いてください。そのまま遊べます。

本番ビルドの見た目を確認する場合は次のようにします。公開時と同じサブパス配下で配信されるため、URL に `/block-drop-game/` が付きます。

```bash
pnpm build
pnpm preview
# → http://localhost:4173/block-drop-game/
```

## テスト

```bash
pnpm test        # 一度だけ実行
pnpm test:watch  # 変更を監視して再実行
pnpm typecheck   # 型チェックのみ
```

ゲームのルール（盤面・回転・ピース順・スコア・状態遷移）は DOM に依存しない `src/core/` に閉じてあるため、ブラウザなしで Node 上でテストできます。

## 公開URLで遊ぶ

`main` に push すると GitHub Actions が型チェックとテストを通したうえでビルドし、GitHub Pages に公開します。

初回だけリポジトリ側の設定が必要です。

1. GitHub のリポジトリ → **Settings** → **Pages**
2. **Build and deployment** の **Source** を **GitHub Actions** に変更

以降は push するだけで更新されます。公開URLは次のとおりです。

```
https://jyasukawa.github.io/block-drop-game/
```

## 構成

```
src/
  core/       ゲームのルール。DOM に触らないので Node 上でテストできる
  platform/   ブラウザ固有の処理（描画・キーボード・タッチ・保存）
  main.ts     配線とゲームループ。時間と乱数はここで用意して core に渡す
tests/        core のテストと、モジュール間の契約を守るテスト
```

依存の向きは `platform → core` の一方向のみです。`core` からは `window` / `document` / `Math.random` / `Date.now` を参照しません。この分離により、最もバグりやすい回転の壁蹴りテーブルをテストで検算でき、乱数のシードを固定すればピースの出現順を完全に再現できます。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 要件、MVPの完成条件、意図的にスコープ外にしたもの |
| [docs/architecture.md](docs/architecture.md) | 構成図、技術選定の理由（採用しなかった案も）、設計変更の履歴 |
| [docs/plan.md](docs/plan.md) | 実装計画とリスク |
| [docs/progress.md](docs/progress.md) | 開発の経過と設計判断の記録 |

## ライセンス / 名称について

「テトリス」は商標です。本プロダクトは同種のパズルゲームですが、名称・表記にその語を使用していません。画像・音声素材は一切使用せず、すべて図形の描画で表現しています。
