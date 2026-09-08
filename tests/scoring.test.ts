/**
 * scoring のテスト。
 *
 * 期待値は constants.ts から導く。数値を書き写すと、バランス調整のたびに
 * 実装は正しいのにテストだけが赤くなり、調整の邪魔になるため。
 * ただし「どこで段が変わるか」という境界の位置そのものは、意図として明示的に書く。
 */
import { describe, expect, it } from 'vitest'
import {
  DROP_INTERVAL_MS,
  HARD_DROP_POINTS_PER_CELL,
  LINE_CLEAR_BASE,
  LINES_PER_LEVEL,
  MAX_LEVEL,
  SOFT_DROP_POINTS_PER_CELL,
} from '../src/core/constants'
import {
  dropIntervalMs,
  hardDropScore,
  levelFor,
  lineClearScore,
  softDropScore,
} from '../src/core/scoring'

/** 表から期待値を引く。noUncheckedIndexedAccess のため undefined を潰しておく。 */
function baseFor(cleared: number): number {
  const base = LINE_CLEAR_BASE[cleared]
  if (base === undefined) throw new Error(`LINE_CLEAR_BASE に添字 ${cleared} がない`)
  return base
}

function intervalAt(level: number): number {
  const ms = DROP_INTERVAL_MS[level - 1]
  if (ms === undefined) throw new Error(`DROP_INTERVAL_MS にレベル ${level} がない`)
  return ms
}

/** 表に載っている同時消し行数（0 を除く）。 */
const CLEARABLE = Array.from({ length: LINE_CLEAR_BASE.length - 1 }, (_, i) => i + 1)

describe('lineClearScore', () => {
  it('0行なら何レベルでも0点', () => {
    for (const level of [1, 2, MAX_LEVEL]) {
      expect(lineClearScore(0, level)).toBe(0)
    }
  })

  it('表の基礎点にレベルを掛けた値を返す', () => {
    for (const cleared of CLEARABLE) {
      for (const level of [1, 2, 7, MAX_LEVEL]) {
        expect(lineClearScore(cleared, level)).toBe(baseFor(cleared) * level)
      }
    }
  })

  it('消した行数が多いほど1行あたりの点が高い', () => {
    // 「まとめて消すほど得」というルールの意図そのもの。表を触るときの歯止めになる。
    const perLine = CLEARABLE.map((cleared) => baseFor(cleared) / cleared)
    for (let i = 1; i < perLine.length; i += 1) {
      const prev = perLine[i - 1]
      const current = perLine[i]
      if (prev === undefined || current === undefined) throw new Error('比較対象がない')
      expect(current).toBeGreaterThan(prev)
    }
  })

  it('レベル1のときは基礎点そのまま', () => {
    for (const cleared of CLEARABLE) {
      expect(lineClearScore(cleared, 1)).toBe(baseFor(cleared))
    }
  })
})

describe('softDropScore / hardDropScore', () => {
  it('セル数に比例する', () => {
    for (let cells = 0; cells <= 22; cells += 1) {
      expect(softDropScore(cells)).toBe(cells * SOFT_DROP_POINTS_PER_CELL)
      expect(hardDropScore(cells)).toBe(cells * HARD_DROP_POINTS_PER_CELL)
    }
  })

  it('0セルなら0点', () => {
    expect(softDropScore(0)).toBe(0)
    expect(hardDropScore(0)).toBe(0)
  })

  it('倍のセル数なら倍の点になる', () => {
    expect(softDropScore(10)).toBe(softDropScore(5) * 2)
    expect(hardDropScore(10)).toBe(hardDropScore(5) * 2)
  })

  it('ハードドロップのほうがソフトドロップより高い', () => {
    // 一気に落とすほうが得でないと、ハードドロップを使う理由がなくなる。
    expect(HARD_DROP_POINTS_PER_CELL).toBeGreaterThan(SOFT_DROP_POINTS_PER_CELL)
    expect(hardDropScore(20)).toBeGreaterThan(softDropScore(20))
  })
})

describe('levelFor', () => {
  it('0行ならレベル1', () => {
    expect(levelFor(0)).toBe(1)
  })

  it('LINES_PER_LEVEL 行ごとに1上がる', () => {
    expect(levelFor(LINES_PER_LEVEL - 1)).toBe(1)
    expect(levelFor(LINES_PER_LEVEL)).toBe(2)
    expect(levelFor(LINES_PER_LEVEL + 1)).toBe(2)
    expect(levelFor(LINES_PER_LEVEL * 2 - 1)).toBe(2)
    expect(levelFor(LINES_PER_LEVEL * 2)).toBe(3)
  })

  it('MAX_LEVEL の直前・到達・その後で頭打ちになる', () => {
    const linesAtMax = (MAX_LEVEL - 1) * LINES_PER_LEVEL
    expect(levelFor(linesAtMax - 1)).toBe(MAX_LEVEL - 1)
    expect(levelFor(linesAtMax)).toBe(MAX_LEVEL)
    expect(levelFor(linesAtMax + 1)).toBe(MAX_LEVEL)
    expect(levelFor(linesAtMax + LINES_PER_LEVEL)).toBe(MAX_LEVEL)
    expect(levelFor(linesAtMax * 100)).toBe(MAX_LEVEL)
  })

  it('全区間で単調に増え、1 と MAX_LEVEL の範囲に収まる', () => {
    let previous = levelFor(0)
    for (let lines = 0; lines <= (MAX_LEVEL + 3) * LINES_PER_LEVEL; lines += 1) {
      const level = levelFor(lines)
      expect(level).toBeGreaterThanOrEqual(1)
      expect(level).toBeLessThanOrEqual(MAX_LEVEL)
      expect(level).toBeGreaterThanOrEqual(previous)
      previous = level
    }
  })

  it('負の行数でもレベル1に倒れる', () => {
    expect(levelFor(-1)).toBe(1)
    expect(levelFor(-LINES_PER_LEVEL * 5)).toBe(1)
  })
})

describe('dropIntervalMs', () => {
  it('表の値をそのまま返す', () => {
    for (let level = 1; level <= DROP_INTERVAL_MS.length; level += 1) {
      expect(dropIntervalMs(level)).toBe(intervalAt(level))
    }
  })

  it('MAX_LEVEL を超えても例外を投げず最速値で頭打ちになる', () => {
    const fastest = intervalAt(DROP_INTERVAL_MS.length)
    expect(dropIntervalMs(MAX_LEVEL)).toBe(fastest)
    expect(() => dropIntervalMs(MAX_LEVEL + 1)).not.toThrow()
    expect(dropIntervalMs(MAX_LEVEL + 1)).toBe(fastest)
    expect(dropIntervalMs(MAX_LEVEL + 100)).toBe(fastest)
  })

  it('レベル1未満の不正値でも壊れない', () => {
    const slowest = intervalAt(1)
    expect(() => dropIntervalMs(0)).not.toThrow()
    expect(dropIntervalMs(0)).toBe(slowest)
    expect(dropIntervalMs(-5)).toBe(slowest)
    expect(dropIntervalMs(Number.NaN)).toBe(slowest)
  })

  it('レベルが上がるほど間隔が短くなる', () => {
    for (let level = 2; level <= MAX_LEVEL; level += 1) {
      expect(dropIntervalMs(level)).toBeLessThan(dropIntervalMs(level - 1))
    }
  })

  it('間隔は必ず正の値', () => {
    // 0 以下だと1フレームで無限に落ちてループが止まらなくなる。
    for (let level = 1; level <= MAX_LEVEL + 5; level += 1) {
      expect(dropIntervalMs(level)).toBeGreaterThan(0)
    }
  })

  it('levelFor が返すレベルはすべて表に載っている', () => {
    // levelFor と dropIntervalMs の対応が切れると、途中のレベルだけ速度が飛ぶ。
    expect(MAX_LEVEL).toBeLessThanOrEqual(DROP_INTERVAL_MS.length)
  })
})
