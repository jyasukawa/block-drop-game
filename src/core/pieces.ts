/**
 * 7種のピース形状と、4つの回転状態のセル座標。
 *
 * 回転状態を手で4つ書き下すと、どこかで1つ座標を間違えても気づけない。
 * そこで出現時の形だけを定義し、残りは「箱の中で90度回す」計算で導出している。
 * 計算式は1つなので、正しさの検証も1回で済む。
 */
import type { ActivePiece, PieceKind, RotationState, Vec } from './types'
import { BOARD_WIDTH, SPAWN_ORIGIN_Y } from './constants'

export const PIECE_KINDS: readonly PieceKind[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z']

/** 外接ボックスの一辺。SRS はこの箱の中でピースを回す。 */
const BOX_SIZE: Readonly<Record<PieceKind, 3 | 4>> = {
  I: 4, O: 4, J: 3, L: 3, S: 3, T: 3, Z: 3,
}

/**
 * 出現時（rotation = 0）のセル座標。箱の左上が (0,0)、y は下向き。
 *
 *   I  ....      J  X..      L  ..X      O  .XX.
 *      XXXX         XXX         XXX         .XX.
 *      ....         ...         ...         ....
 *
 *   S  .XX      T  .X.      Z  XX.
 *      XX.         XXX         .XX
 *      ...         ...         ...
 */
const SPAWN_CELLS: Readonly<Record<PieceKind, readonly Vec[]>> = {
  I: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
  J: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  L: [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  O: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  S: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  T: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  Z: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
}

/**
 * 箱の中で時計回りに90度回す。y が下向きなので、画面上の「右回転」は (x, y) → (N-1-y, x)。
 * y 上向きの資料をそのまま写すとここで符号を間違える。
 */
function rotateCw(cells: readonly Vec[], n: number): Vec[] {
  return cells.map((c) => ({ x: n - 1 - c.y, y: c.x }))
}

/**
 * O は回転させない。4x4 の箱で回すと位置がずれてしまい、SRS でも O は回転しない扱いになっている。
 */
const CELLS: Readonly<Record<PieceKind, readonly (readonly Vec[])[]>> = (() => {
  const table = {} as Record<PieceKind, readonly (readonly Vec[])[]>
  for (const kind of PIECE_KINDS) {
    const n = BOX_SIZE[kind]
    const states: Vec[][] = []
    let current: Vec[] = SPAWN_CELLS[kind].map((c) => ({ ...c }))
    for (let r = 0; r < 4; r += 1) {
      states.push(current.map((c) => ({ ...c })))
      if (kind !== 'O') current = rotateCw(current, n)
    }
    table[kind] = states
  }
  return table
})()

/** 指定した回転状態でのセル座標（箱のローカル座標）。 */
export function cellsOf(kind: PieceKind, rotation: RotationState): readonly Vec[] {
  const states = CELLS[kind]
  const cells = states[rotation]
  if (!cells) throw new Error(`不正な回転状態: ${kind} ${rotation}`)
  return cells
}

/** 外接ボックスの一辺。描画のプレビュー枠を作るときにも使う。 */
export function boxSizeOf(kind: PieceKind): 3 | 4 {
  return BOX_SIZE[kind]
}

/**
 * 出現位置（箱の左上角の盤面座標）。
 * 幅10・箱4なら x=3 となり、I は列3〜6、O は列4〜5、その他は列3〜5に出る。いずれも一般的な出現位置。
 */
export function spawnPosition(): Vec {
  return { x: Math.floor((BOARD_WIDTH - 4) / 2), y: SPAWN_ORIGIN_Y }
}

/** ピースが実際に占める盤面座標。盤面判定と描画の両方から使う。 */
export function absoluteCells(piece: ActivePiece): Vec[] {
  return cellsOf(piece.kind, piece.rotation).map((c) => ({
    x: c.x + piece.pos.x,
    y: c.y + piece.pos.y,
  }))
}
