/**
 * SRS（Super Rotation System）の回転処理。
 *
 * 単純に回すだけでは壁ぎわや床ぎわで回転が成立せず、遊んだ瞬間に「操作が効かない」と感じる。
 * SRS は回転が失敗したときに、決められた順序で最大5箇所の位置をずらして試す。この表が本体。
 *
 * ★ 最重要の注意 ★
 * 世に出回っているキックテーブルはほぼすべて y 上向きで書かれている。
 * このプロジェクトの座標系は y 下向きなので、**移植するときは y の符号を反転させること。**
 * ここを間違えると「壁では回るのに床では回らない」という分かりにくい壊れ方をする。
 * tests/srs.test.ts で機械的に検算すること。
 *
 * ── Phase 2-B の担当ファイル。シグネチャは契約なので変更しないこと。
 */
import type { ActivePiece, PieceKind, RotationState, Vec } from './types'

/** 回転状態の遷移。キックテーブルの引き方。 */
export type KickKey = '0->1' | '1->0' | '1->2' | '2->1' | '2->3' | '3->2' | '3->0' | '0->3'

/** ピースがその位置に置けるかを判定する関数。board へ依存させないために注入する。 */
export type PlacementCheck = (piece: ActivePiece) => boolean

/**
 * J / L / S / T / Z 共通のキックテーブル（y 下向きに変換済み）。
 *
 * 原典（Tetris Guideline の JLSTZ Wall Kick Data）は y 上向きなので、
 * 各オフセットの y だけを反転して写している。x はどちらの流儀でも右が正なのでそのまま。
 * 例: 原典 `0->R = (0,0) (-1,0) (-1,+1) (0,-2) (-1,-2)` → 下の `0->1`。
 *
 * 逆向きの遷移（0->1 と 1->0 など）は原典の時点で符号反転の関係にある。
 * この性質はテーブルを写し間違えると壊れるので、テストで全遷移について検算している。
 */
export const KICKS_JLSTZ: Readonly<Record<KickKey, readonly Vec[]>> = {
  '0->1': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
  '1->0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
  '1->2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
  '2->1': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
  '2->3': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
  '3->2': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: -2 }, { x: -1, y: -2 }],
  '3->0': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: -2 }, { x: -1, y: -2 }],
  '0->3': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
}

/**
 * I 専用のキックテーブル（y 下向きに変換済み）。
 *
 * I だけ別表なのは、4x4 の箱の中で回すと回転中心が箱の中心からずれるため。
 * JLSTZ と同じ表を使うと、横向きの I を壁ぎわで立てられなくなる。
 * こちらも原典（I Wall Kick Data、y 上向き）の y を反転して写している。
 */
export const KICKS_I: Readonly<Record<KickKey, readonly Vec[]>> = {
  '0->1': [{ x: 0, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 1 }, { x: 1, y: -2 }],
  '1->0': [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, { x: 2, y: -1 }, { x: -1, y: 2 }],
  '1->2': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: -2 }, { x: 2, y: 1 }],
  '2->1': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 2 }, { x: -2, y: -1 }],
  '2->3': [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, { x: 2, y: -1 }, { x: -1, y: 2 }],
  '3->2': [{ x: 0, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 1 }, { x: 1, y: -2 }],
  '3->0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 2 }, { x: -2, y: -1 }],
  '0->3': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: -2 }, { x: 2, y: 1 }],
}

/** 遷移をテーブルの添字に変換する。0->2 のような180度回転は SRS の対象外。 */
function kickKey(from: RotationState, to: RotationState): KickKey {
  const key = `${from}->${to}`
  if (!(key in KICKS_JLSTZ)) throw new Error(`SRS が扱わない遷移: ${key}`)
  return key as KickKey
}

/**
 * その遷移で試すオフセットの列を、試す順に返す。
 * O は回転しないので空配列でよい（回転要求そのものを成功扱いにする）。
 */
export function kicksFor(kind: PieceKind, from: RotationState, to: RotationState): readonly Vec[] {
  if (kind === 'O') return []
  const key = kickKey(from, to)
  return kind === 'I' ? KICKS_I[key] : KICKS_JLSTZ[key]
}

/** dir を足して 0..3 に巡回させる。負の剰余を避けるため 4 を足してから割る。 */
function nextRotation(from: RotationState, dir: 1 | -1): RotationState {
  return (((from + dir) % 4) + 4) % 4 as RotationState
}

/**
 * 回転を試みる。`dir` は 1 が右回転、-1 が左回転。
 * キックを順に試し、最初に `isValid` を満たした位置のピースを返す。すべて失敗したら null。
 */
export function tryRotate(piece: ActivePiece, dir: 1 | -1, isValid: PlacementCheck): ActivePiece | null {
  const to = nextRotation(piece.rotation, dir)
  const kicks = kicksFor(piece.kind, piece.rotation, to)

  // O は 4 状態とも同じセルを占めるので、判定するまでもなく今の位置のまま成立する。
  if (kicks.length === 0) return { kind: piece.kind, rotation: to, pos: piece.pos }

  for (const kick of kicks) {
    const candidate: ActivePiece = {
      kind: piece.kind,
      rotation: to,
      pos: { x: piece.pos.x + kick.x, y: piece.pos.y + kick.y },
    }
    if (isValid(candidate)) return candidate
  }
  return null
}
