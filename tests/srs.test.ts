/**
 * SRS のキックテーブルと回転成立判定のテスト。
 *
 * ここは目視レビューが効かない箇所なので、テーブルは「性質」で検算している。
 * 具体的には (a) 全遷移が5オフセットを持つ (b) 先頭が (0,0) (c) 逆向き遷移が符号反転、の3点。
 * (c) が最も効く。写し間違いや y の反転漏れは、ほぼ必ず対称性の破れとして現れる。
 *
 * 盤面判定は `board.ts` を使わず、テスト内で合成した `PlacementCheck` を渡している。
 * 検証したい壁ぎわ・床ぎわの状況をピンポイントで組めるうえ、他タスクの完成を待たずに済む。
 */
import { describe, expect, it } from 'vitest'
import type { ActivePiece, PieceKind, Vec } from '../src/core/types'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../src/core/constants'
import { absoluteCells } from '../src/core/pieces'
import type { KickKey, PlacementCheck } from '../src/core/srs'
import { KICKS_I, KICKS_JLSTZ, kicksFor, tryRotate } from '../src/core/srs'

const KICK_KEYS: readonly KickKey[] = ['0->1', '1->0', '1->2', '2->1', '2->3', '3->2', '3->0', '0->3']

/** 互いに逆向きの遷移。SRS ではこの2つのオフセット列が要素ごとに符号反転になる。 */
const INVERSE_PAIRS: readonly (readonly [KickKey, KickKey])[] = [
  ['0->1', '1->0'],
  ['1->2', '2->1'],
  ['2->3', '3->2'],
  ['3->0', '0->3'],
]

const keyOf = (c: Vec): string => `${c.x},${c.y}`

/** 符号反転。0 をそのまま `-` すると -0 になり、厳密比較で 0 と別物になってしまう。 */
const negate = (v: Vec): Vec => ({ x: v.x === 0 ? 0 : -v.x, y: v.y === 0 ? 0 : -v.y })

/**
 * 「盤外か、指定した座標が埋まっていたら置けない」判定関数を作る。
 * 本物の盤面を組むより、検証したい1マスだけを埋められるぶん意図が読みやすい。
 */
function placementCheck(filled: readonly Vec[]): PlacementCheck {
  const blocked = new Set(filled.map(keyOf))
  return (piece) =>
    absoluteCells(piece).every(
      (c) =>
        c.x >= 0 && c.x < BOARD_WIDTH && c.y >= 0 && c.y < BOARD_HEIGHT && !blocked.has(keyOf(c)),
    )
}

/** 盤面全体から、指定した座標だけを除いた集合。「周囲を完全に埋める」状況を作るのに使う。 */
function allCellsExcept(open: readonly Vec[]): Vec[] {
  const keep = new Set(open.map(keyOf))
  const cells: Vec[] = []
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      if (!keep.has(keyOf({ x, y }))) cells.push({ x, y })
    }
  }
  return cells
}

const emptyBoard: PlacementCheck = placementCheck([])

const piece = (kind: PieceKind, rotation: ActivePiece['rotation'], x: number, y: number): ActivePiece => ({
  kind,
  rotation,
  pos: { x, y },
})

describe('キックテーブルの構造', () => {
  for (const [name, table] of [
    ['KICKS_JLSTZ', KICKS_JLSTZ],
    ['KICKS_I', KICKS_I],
  ] as const) {
    it(`${name} は全8遷移を持ち、各遷移が5オフセット`, () => {
      expect(Object.keys(table).sort()).toEqual([...KICK_KEYS].sort())
      for (const key of KICK_KEYS) {
        expect(table[key], key).toHaveLength(5)
      }
    })

    it(`${name} は各遷移の1番目が (0,0)`, () => {
      // キックなしで成立する場合を最初に試すため。ここが崩れると余計にずれて回る。
      for (const key of KICK_KEYS) {
        expect(table[key][0], key).toEqual({ x: 0, y: 0 })
      }
    })

    it(`${name} は逆向きの遷移が要素ごとに符号反転`, () => {
      for (const [forward, backward] of INVERSE_PAIRS) {
        const negated = table[forward].map(negate)
        expect(table[backward], `${forward} vs ${backward}`).toEqual(negated)
      }
    })
  }

  it('JLSTZ と I は別の表（I だけ回転中心がずれるため）', () => {
    expect(KICKS_I['0->1']).not.toEqual(KICKS_JLSTZ['0->1'])
  })
})

describe('kicksFor', () => {
  it('I は I 用の表を引く', () => {
    for (const key of KICK_KEYS) {
      const [from, to] = key.split('->').map(Number) as [ActivePiece['rotation'], ActivePiece['rotation']]
      expect(kicksFor('I', from, to)).toEqual(KICKS_I[key])
    }
  })

  it('J / L / S / T / Z は共通の表を引く', () => {
    for (const kind of ['J', 'L', 'S', 'T', 'Z'] as const) {
      for (const key of KICK_KEYS) {
        const [from, to] = key.split('->').map(Number) as [ActivePiece['rotation'], ActivePiece['rotation']]
        expect(kicksFor(kind, from, to), `${kind} ${key}`).toEqual(KICKS_JLSTZ[key])
      }
    }
  })

  it('O は回転しないので空配列', () => {
    expect(kicksFor('O', 0, 1)).toEqual([])
    expect(kicksFor('O', 3, 0)).toEqual([])
  })

  it('180度回転など SRS が扱わない遷移は例外', () => {
    expect(() => kicksFor('T', 0, 2)).toThrow()
    expect(() => kicksFor('T', 1, 1)).toThrow()
  })
})

describe('tryRotate', () => {
  it('何も邪魔がなければキックなしで回転する', () => {
    const result = tryRotate(piece('T', 0, 3, 5), 1, emptyBoard)
    expect(result).toEqual({ kind: 'T', rotation: 1, pos: { x: 3, y: 5 } })
  })

  it('dir が 1 で右回転、-1 で左回転（3 の次は 0 に巡回する）', () => {
    const rotations = ([0, 1, 2, 3] as const).map((r) => {
      const cw = tryRotate(piece('T', r, 3, 5), 1, emptyBoard)
      const ccw = tryRotate(piece('T', r, 3, 5), -1, emptyBoard)
      return [cw?.rotation, ccw?.rotation]
    })
    expect(rotations).toEqual([
      [1, 3],
      [2, 0],
      [3, 1],
      [0, 2],
    ])
  })

  it('左壁ぎわの縦 I は、キックで右にずれて横になる', () => {
    // rotation 1 の I は箱のローカル x=2 の縦棒。pos.x = -2 で盤面の第0列にぴったり接する。
    const vertical = piece('I', 1, -2, 5)
    expect(emptyBoard(vertical)).toBe(true)
    expect(absoluteCells(vertical).map((c) => c.x)).toEqual([0, 0, 0, 0])

    const result = tryRotate(vertical, 1, emptyBoard)
    // キックなし・-1 ずらしはどちらも盤外にはみ出すので、3番目の (+2, 0) で成立する。
    expect(result).toEqual({ kind: 'I', rotation: 2, pos: { x: 0, y: 5 } })
    expect(absoluteCells(result as ActivePiece).map((c) => c.x).sort()).toEqual([0, 1, 2, 3])
  })

  it('床ぎわでは回転が上に押し上げられて成立する', () => {
    // 最下段を1列だけ空けた井戸。縦の J がそこに刺さっている状態。
    const floor: Vec[] = []
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      if (x !== 5) floor.push({ x, y: BOARD_HEIGHT - 1 })
    }
    const isValid = placementCheck(floor)
    const standing = piece('J', 1, 4, 19)
    expect(isValid(standing)).toBe(true)

    const result = tryRotate(standing, 1, isValid)
    // (0,0) と (+1,0) は最下段の壁に、(+1,+1) は盤外にぶつかる。4番目の (0,-2) で上に逃げる。
    expect(result).toEqual({ kind: 'J', rotation: 2, pos: { x: 4, y: 17 } })
  })

  it('周囲が完全に埋まっていれば null', () => {
    const stuck = piece('T', 0, 3, 5)
    const isValid = placementCheck(allCellsExcept(absoluteCells(stuck)))
    expect(isValid(stuck)).toBe(true)

    expect(tryRotate(stuck, 1, isValid)).toBeNull()
    expect(tryRotate(stuck, -1, isValid)).toBeNull()
  })

  it('O は位置を変えずに成功する', () => {
    const o = piece('O', 0, 3, 5)
    expect(tryRotate(o, 1, emptyBoard)).toEqual({ kind: 'O', rotation: 1, pos: { x: 3, y: 5 } })
    expect(tryRotate(o, -1, emptyBoard)).toEqual({ kind: 'O', rotation: 3, pos: { x: 3, y: 5 } })
    // 判定関数を一切呼ばずに成立する（4状態とも同じセルを占めるため）。
    const never: PlacementCheck = () => false
    expect(tryRotate(o, 1, never)).toEqual({ kind: 'O', rotation: 1, pos: { x: 3, y: 5 } })
  })

  it('元のピースを書き換えない', () => {
    const original = piece('T', 0, 3, 5)
    tryRotate(original, 1, emptyBoard)
    expect(original).toEqual({ kind: 'T', rotation: 0, pos: { x: 3, y: 5 } })
  })
})
