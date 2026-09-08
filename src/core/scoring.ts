/**
 * 加点とレベルの計算。すべて constants.ts の値から導く。
 *
 * ── Phase 2-C の担当ファイル。シグネチャは契約なので変更しないこと。
 */
import {
  DROP_INTERVAL_MS,
  HARD_DROP_POINTS_PER_CELL,
  LINE_CLEAR_BASE,
  LINES_PER_LEVEL,
  MAX_LEVEL,
  SOFT_DROP_POINTS_PER_CELL,
} from './constants'

/** 同時消し行数とレベルからライン消去の点数を返す。0行なら0点。 */
export function lineClearScore(cleared: number, level: number): number {
  const base = LINE_CLEAR_BASE[cleared]
  // 表にない行数（負や5以上）は加点しない。1回の設置で5行は消えないが、
  // 呼び出し側の数え間違いでゲームループごと止まるほうが被害が大きい。
  if (base === undefined) return 0
  return base * level
}

/** ソフトドロップで落ちたセル数分の点数。 */
export function softDropScore(cells: number): number {
  return cells * SOFT_DROP_POINTS_PER_CELL
}

/** ハードドロップで落ちたセル数分の点数。 */
export function hardDropScore(cells: number): number {
  return cells * HARD_DROP_POINTS_PER_CELL
}

/** 累計消去行数から現在のレベル（1始まり、MAX_LEVEL で頭打ち）を返す。 */
export function levelFor(totalLines: number): number {
  // レベルは 1 始まりなので、0行の時点で 1。NaN や負の行数でも 1 に倒しておく。
  if (!Number.isFinite(totalLines) || totalLines <= 0) return 1
  return Math.min(Math.floor(totalLines / LINES_PER_LEVEL) + 1, MAX_LEVEL)
}

/** レベルに対応する自然落下の間隔（ミリ秒）。MAX_LEVEL を超えたら最速値で頭打ち。 */
export function dropIntervalMs(level: number): number {
  // MAX_LEVEL ではなく表の長さで頭打ちにするのは、MAX_LEVEL だけ上げて
  // DROP_INTERVAL_MS を伸ばし忘れたときに例外ではなく最速値で動き続けるようにするため。
  const lastIndex = DROP_INTERVAL_MS.length - 1
  const index = Number.isFinite(level)
    ? Math.min(Math.max(Math.floor(level) - 1, 0), lastIndex)
    : 0
  const ms = DROP_INTERVAL_MS[index]
  if (ms === undefined) throw new Error('DROP_INTERVAL_MS が空になっている')
  return ms
}
