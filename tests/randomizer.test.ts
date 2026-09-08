/**
 * randomizer のテスト。
 *
 * ここで守りたいのは「同じシードなら同じ試合になる」こと。
 * 不具合報告からシードだけを受け取って再現するのが目的なので、決定性を最優先で確認する。
 */
import { describe, expect, it } from 'vitest'
import type { PieceKind, Randomizer } from '../src/core/types'
import { PIECE_KINDS } from '../src/core/pieces'
import { createBagRandomizer, createSeededRng } from '../src/core/randomizer'

/** 袋ひとつぶんの個数。7 を直接書かないのは、種類が増えてもテストが追従するようにするため。 */
const BAG_SIZE = PIECE_KINDS.length

function takeNumbers(rng: () => number, count: number): number[] {
  return Array.from({ length: count }, () => rng())
}

function takeKinds(randomizer: Randomizer, count: number): PieceKind[] {
  return Array.from({ length: count }, () => randomizer.next())
}

/** 連続した出現列を袋ごとの区間に切り分ける。 */
function chunkIntoBags(kinds: readonly PieceKind[]): PieceKind[][] {
  const bags: PieceKind[][] = []
  for (let i = 0; i < kinds.length; i += BAG_SIZE) {
    bags.push(kinds.slice(i, i + BAG_SIZE))
  }
  return bags
}

describe('createSeededRng', () => {
  it('同じシードなら同じ列を返す', () => {
    const a = takeNumbers(createSeededRng(12345), 500)
    const b = takeNumbers(createSeededRng(12345), 500)
    expect(a).toEqual(b)
  })

  it('異なるシードなら異なる列になる', () => {
    const a = takeNumbers(createSeededRng(1), 500)
    const b = takeNumbers(createSeededRng(2), 500)
    expect(a).not.toEqual(b)
  })

  it('常に 0 以上 1 未満を返す', () => {
    // 境界を踏み抜くと Fisher-Yates の添字が範囲外になるので、回数を多めに取る。
    const values = takeNumbers(createSeededRng(0xc0ffee), 100_000)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThan(1)
    expect(values.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('シードが 0 でも列が固まらない', () => {
    // 状態を 0 で初期化する実装だと最初の数値が退化しやすいので、明示的に見ておく。
    const values = takeNumbers(createSeededRng(0), 100)
    expect(new Set(values).size).toBeGreaterThan(1)
  })
})

describe('createBagRandomizer', () => {
  it('7個ごとに7種をちょうど1回ずつ返す', () => {
    const randomizer = createBagRandomizer(createSeededRng(42))
    const bags = chunkIntoBags(takeKinds(randomizer, BAG_SIZE * 10))
    expect(bags).toHaveLength(10)
    for (const bag of bags) {
      expect([...bag].sort()).toEqual([...PIECE_KINDS].sort())
    }
  })

  it('どのシードでも袋の性質が崩れない', () => {
    for (const seed of [0, 1, 7, 99, 123456, 0x7fffffff]) {
      const randomizer = createBagRandomizer(createSeededRng(seed))
      for (const bag of chunkIntoBags(takeKinds(randomizer, BAG_SIZE * 5))) {
        expect([...bag].sort()).toEqual([...PIECE_KINDS].sort())
      }
    }
  })

  it('同じシードなら出現順が完全に再現される', () => {
    // 不具合報告をシードだけで再現するための、いちばん大事な性質。
    const a = takeKinds(createBagRandomizer(createSeededRng(2024)), BAG_SIZE * 30)
    const b = takeKinds(createBagRandomizer(createSeededRng(2024)), BAG_SIZE * 30)
    expect(a).toEqual(b)
  })

  it('異なるシードなら出現順が変わる', () => {
    const a = takeKinds(createBagRandomizer(createSeededRng(1)), BAG_SIZE * 30)
    const b = takeKinds(createBagRandomizer(createSeededRng(2)), BAG_SIZE * 30)
    expect(a).not.toEqual(b)
  })

  it('袋の中身がシャッフルされている', () => {
    // 「毎回 PIECE_KINDS のまま返す」実装を弾く。20袋も見れば偶然すべて同じ並びにはならない。
    const randomizer = createBagRandomizer(createSeededRng(777))
    const orders = chunkIntoBags(takeKinds(randomizer, BAG_SIZE * 20)).map((bag) => bag.join(''))
    expect(new Set(orders).size).toBeGreaterThan(1)
    expect(orders.some((order) => order !== PIECE_KINDS.join(''))).toBe(true)
  })

  it('袋の先頭に来る種類がシードによって散らばる', () => {
    // 特定の種類しか先頭に来ない偏りがないことの、粗いが安価な確認。
    const firsts = new Set<PieceKind>()
    for (let seed = 0; seed < 200; seed += 1) {
      firsts.add(createBagRandomizer(createSeededRng(seed)).next())
    }
    expect(firsts.size).toBe(BAG_SIZE)
  })

  it('十分な回数を回すと各種類がほぼ同数になる', () => {
    const bags = 700
    const randomizer = createBagRandomizer(createSeededRng(31337))
    const counts = new Map<PieceKind, number>()
    for (const kind of takeKinds(randomizer, BAG_SIZE * bags)) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
    // 袋の性質から、区間が袋の倍数なら各種類はちょうど袋の個数だけ出るはず。
    for (const kind of PIECE_KINDS) {
      expect(counts.get(kind)).toBe(bags)
    }
  })
})
