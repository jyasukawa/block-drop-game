import { describe, expect, it } from 'vitest'
import type { ActivePiece, Board, Cell, PieceKind, RotationState } from '../src/core/types'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../src/core/constants'
import { PIECE_KINDS } from '../src/core/pieces'
import {
  clearLines,
  createEmptyBoard,
  dropDistance,
  ghostOf,
  isValidPosition,
  lockPiece,
} from '../src/core/board'

// ── テスト用ヘルパー ────────────────────────────────────
// 盤面を配列リテラルで組み立てると、どの行がどう埋まっているかが読み取れない。
// 見た目そのままの文字列で書けるようにして、期待値と実際の形を目で照合できるようにする。

/** '.' は空、それ以外の1文字はその種類のブロック。 */
function cellOf(char: string): Cell {
  if (char === '.') return null
  if (!PIECE_KINDS.includes(char as PieceKind)) throw new Error(`不正なセル文字: ${char}`)
  return char as PieceKind
}

/**
 * 文字列の行から盤面を作る。行は**下詰め**で配置し、足りない分は上を空行で埋める。
 * 底の数行だけを書けば済むので、テストの本題（どこが埋まっているか）だけが残る。
 */
function boardOf(rows: readonly string[], height: number = BOARD_HEIGHT): Board {
  const width = rows[0]?.length ?? BOARD_WIDTH
  const filled = rows.map((row) => {
    if (row.length !== width) throw new Error(`行の幅が揃っていない: ${row}`)
    return [...row].map(cellOf)
  })
  const padding: Cell[][] = []
  for (let i = 0; i < height - filled.length; i += 1) {
    padding.push(new Array<Cell>(width).fill(null))
  }
  return { width, height, cells: [...padding, ...filled] }
}

/** 盤面を文字列の行に戻す。expect の差分が読める形になる。 */
function rowsOf(board: Board): string[] {
  return board.cells.map((row) =>
    Array.from({ length: board.width }, (_, x) => row[x] ?? '.').join(''),
  )
}

/** 底から n 行。埋まっていない上の方まで比較しても意味がないので切り出す。 */
function bottomRows(board: Board, n: number): string[] {
  return rowsOf(board).slice(board.height - n)
}

function pieceAt(kind: PieceKind, x: number, y: number, rotation: RotationState = 0): ActivePiece {
  return { kind, rotation, pos: { x, y } }
}

const FULL = 'I'.repeat(BOARD_WIDTH)

// ── createEmptyBoard ────────────────────────────────────

describe('createEmptyBoard', () => {
  it('既定の寸法で、全マスが null', () => {
    const board = createEmptyBoard()
    expect(board.width).toBe(BOARD_WIDTH)
    expect(board.height).toBe(BOARD_HEIGHT)
    expect(board.cells).toHaveLength(BOARD_HEIGHT)
    for (const row of board.cells) {
      expect(row).toHaveLength(BOARD_WIDTH)
      expect(row.every((cell) => cell === null)).toBe(true)
    }
  })

  it('寸法を指定できる', () => {
    const board = createEmptyBoard(4, 6)
    expect(board.width).toBe(4)
    expect(board.height).toBe(6)
    expect(board.cells.every((row) => row.length === 4)).toBe(true)
  })

  it('行が共有されていない（1マス書き換えても他の行に影響しない）', () => {
    const board = createEmptyBoard(4, 3)
    expect(board.cells[0]).not.toBe(board.cells[1])
  })
})

// ── isValidPosition ─────────────────────────────────────

describe('isValidPosition', () => {
  const empty = createEmptyBoard()

  it('空盤面の中央に置ける', () => {
    expect(isValidPosition(empty, pieceAt('O', 3, 0))).toBe(true)
    expect(isValidPosition(empty, pieceAt('T', 3, 5))).toBe(true)
  })

  it('左壁からはみ出すと false', () => {
    // O は箱の x=1,2 を占めるので、pos.x=-1 までは盤面内に収まる。
    expect(isValidPosition(empty, pieceAt('O', -1, 0))).toBe(true)
    expect(isValidPosition(empty, pieceAt('O', -2, 0))).toBe(false)
    expect(isValidPosition(empty, pieceAt('T', 0, 0))).toBe(true)
    expect(isValidPosition(empty, pieceAt('T', -1, 0))).toBe(false)
  })

  it('右壁からはみ出すと false', () => {
    expect(isValidPosition(empty, pieceAt('O', BOARD_WIDTH - 3, 0))).toBe(true)
    expect(isValidPosition(empty, pieceAt('O', BOARD_WIDTH - 2, 0))).toBe(false)
    expect(isValidPosition(empty, pieceAt('I', BOARD_WIDTH - 4, 0))).toBe(true)
    expect(isValidPosition(empty, pieceAt('I', BOARD_WIDTH - 3, 0))).toBe(false)
  })

  it('床からはみ出すと false', () => {
    // O は箱の y=0,1 を占める。pos.y = height-2 が最下段。
    expect(isValidPosition(empty, pieceAt('O', 3, BOARD_HEIGHT - 2))).toBe(true)
    expect(isValidPosition(empty, pieceAt('O', 3, BOARD_HEIGHT - 1))).toBe(false)
  })

  it('上方向のはみ出し（y < 0）は false', () => {
    // I は箱の y=1 だけを占めるので、pos.y=-1 なら盤面の 0 行目に収まる。
    expect(isValidPosition(empty, pieceAt('I', 3, -1))).toBe(true)
    expect(isValidPosition(empty, pieceAt('I', 3, -2))).toBe(false)
    // O は箱の y=0 を占めるので、pos.y=-1 の時点で y=-1 に出てしまう。
    expect(isValidPosition(empty, pieceAt('O', 3, -1))).toBe(false)
  })

  it('既存ブロックと重なると false', () => {
    const board = boardOf([
      '....S.....',
      '..........',
    ])
    // 底から2行目の x=4 が埋まっている。O(pos.x=3) は x=4,5 を占める。
    expect(isValidPosition(board, pieceAt('O', 3, BOARD_HEIGHT - 2))).toBe(false)
    // 1つ左にずらせば x=3,4 … これも x=4 に当たる。
    expect(isValidPosition(board, pieceAt('O', 2, BOARD_HEIGHT - 2))).toBe(false)
    // さらに左なら x=2,3 で当たらない。
    expect(isValidPosition(board, pieceAt('O', 1, BOARD_HEIGHT - 2))).toBe(true)
  })

  it('回転状態を考慮する', () => {
    const empty10 = createEmptyBoard()
    // 縦向きの I（rotation=1）は箱の x=2 の列を y=0..3 で占める。
    expect(isValidPosition(empty10, pieceAt('I', -2, 0, 1))).toBe(true)
    expect(isValidPosition(empty10, pieceAt('I', -3, 0, 1))).toBe(false)
    expect(isValidPosition(empty10, pieceAt('I', BOARD_WIDTH - 3, 0, 1))).toBe(true)
    expect(isValidPosition(empty10, pieceAt('I', BOARD_WIDTH - 2, 0, 1))).toBe(false)
    expect(isValidPosition(empty10, pieceAt('I', 3, BOARD_HEIGHT - 4, 1))).toBe(true)
    expect(isValidPosition(empty10, pieceAt('I', 3, BOARD_HEIGHT - 3, 1))).toBe(false)
  })
})

// ── lockPiece ───────────────────────────────────────────

describe('lockPiece', () => {
  it('ピースの種類でセルが埋まる', () => {
    const board = lockPiece(createEmptyBoard(), pieceAt('O', 3, BOARD_HEIGHT - 2))
    expect(bottomRows(board, 2)).toEqual([
      '....OO....',
      '....OO....',
    ])
  })

  it('元の盤面を変更せず、新しい盤面を返す', () => {
    const before = createEmptyBoard()
    const snapshot = rowsOf(before)
    const after = lockPiece(before, pieceAt('T', 3, BOARD_HEIGHT - 2))

    expect(after).not.toBe(before)
    expect(rowsOf(before)).toEqual(snapshot)
    expect(before.cells.every((row) => row.every((cell) => cell === null))).toBe(true)
    expect(bottomRows(after, 2)).toEqual([
      '....T.....',
      '...TTT....',
    ])
  })

  it('既存のブロックはそのまま残る', () => {
    const before = boardOf([
      '.........Z',
      'S........Z',
    ])
    const after = lockPiece(before, pieceAt('O', 3, BOARD_HEIGHT - 2))
    expect(bottomRows(after, 2)).toEqual([
      '....OO...Z',
      'S...OO...Z',
    ])
    // 元の盤面には O が入っていないこと。
    expect(bottomRows(before, 2)).toEqual([
      '.........Z',
      'S........Z',
    ])
  })

  it('触っていない行は元の盤面と同じ配列を共有する（不要なコピーをしない）', () => {
    const before = boardOf(['S.........'])
    const after = lockPiece(before, pieceAt('O', 3, 0))
    expect(after.cells[BOARD_HEIGHT - 1]).toBe(before.cells[BOARD_HEIGHT - 1])
  })
})

// ── clearLines ──────────────────────────────────────────

describe('clearLines', () => {
  it('埋まった行が無ければ何も起きない', () => {
    const board = boardOf([
      '.IIIIIIIII',
      'IIIIIIIII.',
    ])
    const result = clearLines(board)
    expect(result.cleared).toBe(0)
    expect(result.board).toBe(board)
  })

  it('1行消去', () => {
    const result = clearLines(boardOf([
      'T.........',
      FULL,
    ]))
    expect(result.cleared).toBe(1)
    expect(bottomRows(result.board, 2)).toEqual([
      '..........',
      'T.........',
    ])
  })

  it('2行消去', () => {
    const result = clearLines(boardOf([
      'T........T',
      FULL,
      FULL,
    ]))
    expect(result.cleared).toBe(2)
    expect(bottomRows(result.board, 3)).toEqual([
      '..........',
      '..........',
      'T........T',
    ])
  })

  it('3行消去', () => {
    const result = clearLines(boardOf([
      'S.........',
      FULL,
      FULL,
      FULL,
    ]))
    expect(result.cleared).toBe(3)
    expect(bottomRows(result.board, 4)).toEqual([
      '..........',
      '..........',
      '..........',
      'S.........',
    ])
  })

  it('4行同時消去', () => {
    const result = clearLines(boardOf([
      'Z........Z',
      FULL,
      FULL,
      FULL,
      FULL,
    ]))
    expect(result.cleared).toBe(4)
    expect(bottomRows(result.board, 5)).toEqual([
      '..........',
      '..........',
      '..........',
      '..........',
      'Z........Z',
    ])
    expect(result.board.height).toBe(BOARD_HEIGHT)
    expect(result.board.cells).toHaveLength(BOARD_HEIGHT)
  })

  it('消える行と消えない行が混在しても、消えない行の内容が保持される', () => {
    const result = clearLines(boardOf([
      'T........L',
      FULL,
      'S.......S.',
      FULL,
      '.J.....J..',
    ]))
    expect(result.cleared).toBe(2)
    // 消えた2行の分だけ上から空行が入り、残った3行は順序を保ったまま下に詰まる。
    expect(bottomRows(result.board, 5)).toEqual([
      '..........',
      '..........',
      'T........L',
      'S.......S.',
      '.J.....J..',
    ])
  })

  it('元の盤面を変更しない', () => {
    const before = boardOf(['T.........', FULL])
    const snapshot = rowsOf(before)
    clearLines(before)
    expect(rowsOf(before)).toEqual(snapshot)
  })

  it('盤面が全て埋まっていれば全行消えて空になる', () => {
    const rows: string[] = []
    for (let i = 0; i < BOARD_HEIGHT; i += 1) rows.push(FULL)
    const result = clearLines(boardOf(rows))
    expect(result.cleared).toBe(BOARD_HEIGHT)
    expect(result.board.cells.every((row) => row.every((cell) => cell === null))).toBe(true)
  })
})

// ── dropDistance ────────────────────────────────────────

describe('dropDistance', () => {
  it('空盤面では床まで落ちる', () => {
    const empty = createEmptyBoard()
    // O の下端は箱の y=1 なので、pos.y は height-2 が限界。
    expect(dropDistance(empty, pieceAt('O', 3, 0))).toBe(BOARD_HEIGHT - 2)
  })

  it('着地済みなら 0', () => {
    const empty = createEmptyBoard()
    expect(dropDistance(empty, pieceAt('O', 3, BOARD_HEIGHT - 2))).toBe(0)

    const stacked = boardOf([FULL])
    expect(dropDistance(stacked, pieceAt('O', 3, BOARD_HEIGHT - 3))).toBe(0)
  })

  it('積まれたブロックの上で止まる', () => {
    const board = boardOf([
      '....SS....',
      '....SS....',
    ])
    // 底から2行が x=4,5 で埋まっているので、O は底から3行目に着地する。
    expect(dropDistance(board, pieceAt('O', 3, 0))).toBe(BOARD_HEIGHT - 4)
  })

  it('オーバーハングの下の穴には落ちない', () => {
    const board = boardOf([
      '.....LLLLL', // 底から3行目に庇がある
      '..........', // その下は空洞
      '.........J',
    ])
    // 列5,6 は庇に塞がれているので、その1つ上で止まる。
    expect(dropDistance(board, pieceAt('O', 4, 0))).toBe(BOARD_HEIGHT - 5)
    // 列2,3 には何も無いので床まで落ちる。
    expect(dropDistance(board, pieceAt('O', 1, 0))).toBe(BOARD_HEIGHT - 2)
  })

  it('凹凸のある地形では一番低い列ではなく、ピースが当たる列で止まる', () => {
    const board = boardOf([
      '.......TTT',
      '....TTTTTT',
    ])
    // 縦向き I が占めるのは列 pos.x+2。列6 の最上段ブロックは底から1行目。
    expect(dropDistance(board, pieceAt('I', 4, 0, 1))).toBe(BOARD_HEIGHT - 5)
    // 列8 は底から2行目まで埋まっているので、1つ浅くなる。
    expect(dropDistance(board, pieceAt('I', 6, 0, 1))).toBe(BOARD_HEIGHT - 6)
  })
})

// ── ghostOf ─────────────────────────────────────────────

describe('ghostOf', () => {
  it('dropDistance だけ下げた、同じ種類・同じ回転のピースを返す', () => {
    const board = boardOf([
      '....SS....',
      '....SS....',
    ])
    const piece = pieceAt('T', 3, 2, 3)
    const ghost = ghostOf(board, piece)

    expect(ghost.kind).toBe(piece.kind)
    expect(ghost.rotation).toBe(piece.rotation)
    expect(ghost.pos.x).toBe(piece.pos.x)
    expect(ghost.pos.y).toBe(piece.pos.y + dropDistance(board, piece))
  })

  it('着地済みのピースはその場に留まる', () => {
    const empty = createEmptyBoard()
    const landed = pieceAt('O', 3, BOARD_HEIGHT - 2)
    expect(ghostOf(empty, landed)).toEqual(landed)
  })

  it('ゴーストの位置は必ず有効で、そこから1つ下は無効', () => {
    const board = boardOf([
      '.....LLLLL',
      '..........',
      '.........J',
    ])
    for (const kind of PIECE_KINDS) {
      const ghost = ghostOf(board, pieceAt(kind, 3, 0))
      expect(isValidPosition(board, ghost)).toBe(true)
      expect(isValidPosition(board, { ...ghost, pos: { x: ghost.pos.x, y: ghost.pos.y + 1 } })).toBe(false)
    }
  })

  it('元のピースを変更しない', () => {
    const board = createEmptyBoard()
    const piece = pieceAt('L', 3, 1)
    ghostOf(board, piece)
    expect(piece.pos).toEqual({ x: 3, y: 1 })
  })
})
