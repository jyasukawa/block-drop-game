/**
 * モジュール間の契約を守るテスト。
 *
 * 各モジュールの単体テストは自分の担当しか見ていないので、境界の食い違いは検出できない。
 * 特に `srs.tryRotate` は盤外にはみ出す候補位置も `isValid` に渡すため、
 * `board.isValidPosition` が例外を投げずに false を返すことに依存している。
 * この前提が崩れると「左壁ぎわで回転しようとするとクラッシュする」という壊れ方をする。
 */
import { describe, expect, it } from 'vitest'
import { createEmptyBoard, isValidPosition, lockPiece, clearLines, dropDistance } from '../src/core/board'
import { tryRotate } from '../src/core/srs'
import { createBagRandomizer, createSeededRng } from '../src/core/randomizer'
import { lineClearScore, levelFor, dropIntervalMs } from '../src/core/scoring'
import { spawnPosition } from '../src/core/pieces'
import type { ActivePiece } from '../src/core/types'

describe('タスク間の噛み合わせ', () => {
  const board = createEmptyBoard()
  const check = (p: ActivePiece) => isValidPosition(board, p)

  it('board.isValidPosition は盤外の座標で例外を投げず false を返す（srs のキックが依存）', () => {
    const cases: ActivePiece[] = [
      { kind: 'I', rotation: 1, pos: { x: -5, y: 5 } },
      { kind: 'I', rotation: 1, pos: { x: 99, y: 5 } },
      { kind: 'T', rotation: 0, pos: { x: 3, y: -9 } },
      { kind: 'T', rotation: 0, pos: { x: 3, y: 999 } },
      { kind: 'O', rotation: 0, pos: { x: -100, y: -100 } },
    ]
    for (const p of cases) {
      expect(() => isValidPosition(board, p)).not.toThrow()
      expect(isValidPosition(board, p)).toBe(false)
    }
  })

  it('本物の盤面で、左壁ぎわの I がキックして回転できる', () => {
    // 縦向きの I を左端に寄せる
    let piece: ActivePiece = { kind: 'I', rotation: 1, pos: { x: -2, y: 5 } }
    expect(isValidPosition(board, piece)).toBe(true)
    const rotated = tryRotate(piece, 1, check)
    expect(rotated).not.toBeNull()
    expect(isValidPosition(board, rotated!)).toBe(true)
    piece = rotated!
    expect(piece.rotation).toBe(2)
  })

  it('出現位置のピースが空盤面に置ける', () => {
    for (const kind of ['I', 'J', 'L', 'O', 'S', 'T', 'Z'] as const) {
      expect(isValidPosition(board, { kind, rotation: 0, pos: spawnPosition() })).toBe(true)
    }
  })

  it('ハードドロップ → 設置 → ライン消去 → 加点が一連で通る', () => {
    // 最下段を I 2枚 + O 1枚 で 10 列埋める
    let b = createEmptyBoard()
    const place = (p: ActivePiece) => {
      const d = dropDistance(b, p)
      const landed: ActivePiece = { ...p, pos: { x: p.pos.x, y: p.pos.y + d } }
      expect(isValidPosition(b, landed)).toBe(true)
      b = lockPiece(b, landed)
    }
    place({ kind: 'I', rotation: 0, pos: { x: 0, y: 0 } })  // 列 0-3
    place({ kind: 'I', rotation: 0, pos: { x: 4, y: 0 } })  // 列 4-7
    place({ kind: 'O', rotation: 0, pos: { x: 7, y: 0 } })   // 列 8-9（2段）

    const before = b
    const { board: after, cleared } = clearLines(b)
    expect(cleared).toBe(1)
    expect(after).not.toBe(before)
    expect(lineClearScore(cleared, 1)).toBe(100)
  })

  it('7-bag が同じシードで再現し、レベルと落下間隔が繋がる', () => {
    const take = (seed: number) => {
      const r = createBagRandomizer(createSeededRng(seed))
      return Array.from({ length: 14 }, () => r.next())
    }
    expect(take(42)).toEqual(take(42))
    expect(new Set(take(42).slice(0, 7)).size).toBe(7)
    expect(levelFor(0)).toBe(1)
    expect(dropIntervalMs(levelFor(0))).toBe(1000)
    expect(dropIntervalMs(levelFor(30))).toBeLessThan(dropIntervalMs(levelFor(0)))
    expect(() => dropIntervalMs(999)).not.toThrow()
  })
})
