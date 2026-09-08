/**
 * 盤面の保持、衝突判定、ライン消去。
 *
 * 盤面は不変（immutable）として扱う。設置や消去は新しい Board を返す。
 * 状態を書き換えないので、テストで「この盤面にこれを置いたらこうなる」を1行で書ける。
 *
 * ── Phase 2-A の担当ファイル。シグネチャは契約なので変更しないこと。
 */
import type { ActivePiece, Board, Cell, LineClearResult } from './types'
import { BOARD_HEIGHT, BOARD_WIDTH } from './constants'
import { absoluteCells } from './pieces'

/** 全マス空の盤面を作る。 */
export function createEmptyBoard(width: number = BOARD_WIDTH, height: number = BOARD_HEIGHT): Board {
  const cells: Cell[][] = []
  for (let y = 0; y < height; y += 1) {
    cells.push(new Array<Cell>(width).fill(null))
  }
  return { width, height, cells }
}

/**
 * ピースがその位置に置けるか。
 * 盤面外（左右・下）にはみ出す、または既に埋まっているセルと重なる場合は false。
 * **上方向のはみ出し（y < 0）は false** とする。バッファ行より上には置けない。
 */
export function isValidPosition(board: Board, piece: ActivePiece): boolean {
  return absoluteCells(piece).every(({ x, y }) => {
    if (x < 0 || x >= board.width || y < 0 || y >= board.height) return false
    // noUncheckedIndexedAccess: 範囲判定済みでも row は Cell[] | undefined になる。
    // ここで undefined を「置けない」に倒しておけば、以降 `!` を使わずに済む。
    const row = board.cells[y]
    return row !== undefined && row[x] === null
  })
}

/** ピースを盤面に固定した新しい盤面を返す。呼ぶ前に isValidPosition で確認しておくこと。 */
export function lockPiece(board: Board, piece: ActivePiece): Board {
  // 触る行だけを差し替える。全行コピーしないのは、元の盤面を共有したままにできるため。
  const cells = board.cells.map((row) => row)
  for (const { x, y } of absoluteCells(piece)) {
    const row = cells[y]
    // 盤面外のセルは無視する。呼び出し側が isValidPosition を通していれば起きないが、
    // ここで落とすと固定処理の途中で盤面が壊れるので、防御的に読み飛ばす。
    if (row === undefined || x < 0 || x >= board.width) continue
    const next = row.slice()
    next[x] = piece.kind
    cells[y] = next
  }
  return { width: board.width, height: board.height, cells }
}

/**
 * 埋まった行を消し、上のセルを下に詰めた盤面と、消した行数を返す。
 * 複数行が同時に埋まっている場合もまとめて処理する。
 */
export function clearLines(board: Board): LineClearResult {
  const kept = board.cells.filter((row) => !isFullRow(row, board.width))
  const cleared = board.height - kept.length
  if (cleared === 0) return { board, cleared: 0 }

  // 残った行の順序は変えずに、消えた分だけ空行を上に足す。
  // これが「上のセルが下に詰まる」ことそのものになる（y は下が正）。
  const empty: Cell[][] = []
  for (let i = 0; i < cleared; i += 1) {
    empty.push(new Array<Cell>(board.width).fill(null))
  }
  return {
    board: { width: board.width, height: board.height, cells: [...empty, ...kept] },
    cleared,
  }
}

/** そのピースが真下に何セル落ちられるか。0 ならすでに着地している。 */
export function dropDistance(board: Board, piece: ActivePiece): number {
  let distance = 0
  // 1セルずつ試すのは、穴やオーバーハングがあっても列ごとの高さ計算に頼らずに済むため。
  // 落下距離はたかだか盤面高さなので、素朴に回して問題ない。
  while (distance < board.height && isValidPosition(board, shiftDown(piece, distance + 1))) {
    distance += 1
  }
  return distance
}

/** 落下位置を予告するゴースト。dropDistance だけ下げた同じピースを返す。 */
export function ghostOf(board: Board, piece: ActivePiece): ActivePiece {
  return shiftDown(piece, dropDistance(board, piece))
}

/** 行がすべて埋まっているか。幅を引数で受けるのは、盤面が既定サイズとは限らないため。 */
function isFullRow(row: readonly Cell[], width: number): boolean {
  for (let x = 0; x < width; x += 1) {
    if (row[x] == null) return false
  }
  return true
}

/** 同じ種類・同じ回転のまま y だけ下げたピース。 */
function shiftDown(piece: ActivePiece, dy: number): ActivePiece {
  return { kind: piece.kind, rotation: piece.rotation, pos: { x: piece.pos.x, y: piece.pos.y + dy } }
}
