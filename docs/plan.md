# 実装計画 — Block Drop

最終更新: 2026-09-08

## フェーズ分解

フェーズは**並列に走らせられる単位**で切る。フェーズ内のタスク同士は互いの成果物を待たない。

| # | フェーズ | 目的 | 完了したら何が動くか |
|---|---|---|---|
| 1 | 基盤と契約 | 型・定数・ピース定義・プロジェクト設定を確定させる | `pnpm dev` でページが開き、空の盤面が描かれる |
| 2 | コアロジック | 盤面・回転・ピース順・スコアを並列で作る | `pnpm test` で各ルールの単体テストが通る |
| 3 | 状態機械 | 上記を束ねてゲームとして成立させる | Node 上でゲームを1局シミュレートできる |
| 4 | 入出力 | 描画・キーボード・タッチ・保存を並列で作る | ブラウザで実際に遊べる |
| 5 | 公開 | GitHub Actions と Pages の設定 | 公開URLで遊べる |

順序の理由: Phase 1 の型が決まらないと Phase 2 を並列に配れない。Phase 3 は Phase 2 の全部を束ねるので逐次。Phase 4 は `GameState` が確定して初めて並列にできる。

---

## Phase 1: 基盤と契約（逐次・オーケストレータが自分で書く） ✅ 完了

並列配布の前に境界を実ファイルとして置く。**ここが曖昧だと Phase 2 の3エージェントが別々の解釈で実装してしまう。**

- [x] `package.json` / `tsconfig.json` / `vite.config.ts` / `index.html` / `src/style.css`
  - 完了の定義: `pnpm dev` が起動し、ブラウザで空の Canvas が表示される
- [x] `src/core/types.ts` — `Cell` `PieceKind` `RotationState` `Piece` `Board` `GameState` `Action` `Rng`
  - 完了の定義: `pnpm exec tsc --noEmit` が通る
- [x] `src/core/constants.ts` — 盤面サイズ、スコア式、レベル別落下間隔、ロックディレイ、DAS/ARR、色、localStorageキー
  - 完了の定義: **調整対象の数値がすべてこの1ファイルに集約されている**（体感調整をここだけで完結させるため）
- [x] `src/core/pieces.ts` — 7種 × 4回転状態のセル座標
  - 完了の定義: 各形状が4セル・重複なし・境界内であることをテストで確認

## Phase 2: コアロジック（並列3タスク・書くファイルが重ならない） ✅ 完了

- [x] **2-A 盤面** — `src/core/board.ts`, `tests/board.test.ts`
  - 完了の定義: 空盤面への設置、壁・床・既存ブロックとの衝突検出、1〜4列同時消去で上のセルが正しく下がる、が全てテストで通る
  - 書いてよい: 上記2ファイルのみ
- [x] **2-B 回転とSRS** — `src/core/srs.ts`, `tests/srs.test.ts`
  - 完了の定義: 全キックテーブルが y 下向きに変換済みであることを検算するテストが通る。壁ぎわ・床ぎわ・Tスピン型のはまり込みで回転が成立する代表ケースが通る
  - 書いてよい: 上記2ファイルのみ
- [x] **2-C ピース順とスコア** — `src/core/randomizer.ts`, `src/core/scoring.ts`, `tests/randomizer.test.ts`, `tests/scoring.test.ts`
  - 完了の定義: 同一シードで出現順が完全再現される。7個単位で7種がちょうど1回ずつ出る。スコアとレベルが定義どおり計算される
  - 書いてよい: 上記4ファイルのみ

全タスク共通で、`src/core/types.ts` と `src/core/constants.ts` は**読むが変更しない**。契約に無理があれば報告する。

## Phase 3: 状態機械（逐次） ✅ 完了

- [x] `src/core/game.ts`, `tests/game.test.ts`
  - 完了の定義: `tick(dt)` で自然落下・ロックディレイ・ロック・ライン消去・次ピース出現が進み、`apply(action)` で移動/回転/ホールド/ハードドロップが反映される。出現位置が埋まっていればゲームオーバーになる。**シードを固定して一定手順を流すと毎回同じ最終状態になる**

## Phase 4: 入出力（並列3タスク） ✅ 完了

- [x] **4-A 描画** — `src/platform/render.ts`
  - 完了の定義: 盤面・落下中ピース・ゴースト・ネクスト・ホールド・スコア・レベル・ハイスコア・ポーズ／ゲームオーバー表示が描かれる。`devicePixelRatio` 対応でスマホでぼやけない
- [x] **4-B キーボード入力** — `src/platform/input-keyboard.ts`
  - 完了の定義: 定義した全キーが `Action` に翻訳される。長押しが DAS/ARR に従って連続移動になる。矢印キーでページがスクロールしない
- [x] **4-C タッチ入力と保存** — `src/platform/input-touch.ts`, `src/platform/storage.ts`
  - 完了の定義: 横ドラッグでセル単位に追従移動、タップで右回転、下フリックでハードドロップ、下ゆっくりドラッグでソフトドロップ。HOLD/PAUSEボタンが機能する。localStorage が使えない環境でも**例外を投げずに**メモリ値へフォールバックする

## Phase 5: 公開（逐次）

- [ ] `.github/workflows/deploy.yml`、`vite.config.ts` の `base` 設定
  - 完了の定義: main への push で Pages が更新され、**公開URLをスマホで開いて実際に遊べる**

---

## リスクと詰まりそうなところ

| 懸念 | 影響 | 対処 |
|---|---|---|
| キックテーブルの y 符号ミス | 壁ぎわで回転が効かず、遊べるが不快 | Phase 2-B のテストで機械的に検算する |
| GitHub Pages のサブパス | `/リポジトリ名/` 配下になり、絶対パス指定の資産が404になる | `vite.config.ts` の `base` を最初から設定する |
| iOS Safari のタッチ既定動作 | スワイプでページが引っ張られ、操作にならない | `touch-action: none` と `preventDefault` を Phase 4-C の完了条件に含める |
| localStorage の例外 | 開いても遊べない最悪の結果 | try/catch とフォールバックを Phase 4-C の完了条件に含める |
| 操作感（DAS/ARR、ロックディレイ） | 遊び心地に最も影響するが、言葉では決まらない | 値を `constants.ts` に集約し、Phase 4 完了後に実際に触って調整する |
