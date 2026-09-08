import { describe, expect, it } from 'vitest'
import { createGame, type Game } from '../src/core/game'
import { BOARD_WIDTH, LOCK_DELAY_MS, SOFT_DROP_INTERVAL_MS, SPAWN_ORIGIN_Y, VISIBLE_ROWS } from '../src/core/constants'
import { dropDistance, isValidPosition, lockPiece } from '../src/core/board'
import type { Action, Board, RotationState } from '../src/core/types'

/** 経過時間を細かく刻んで進める。1回に大きな dt を渡すとロック猶予を飛び越えてしまう。 */
function run(game: Game, totalMs: number, stepMs = 16): void {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) game.tick(stepMs)
}

/**
 * 着地した直後（まだロックされていない）まで進める。
 *
 * 刻み幅をソフトドロップの落下間隔より大きく取るのが要点。小さいと「まだ時間が
 * 足りなくて落ちていないだけ」を「着地した」と読み違えて、その場で止まってしまう。
 */
function fallUntilGrounded(game: Game): void {
  game.apply({ type: 'softDropStart' })
  for (let i = 0; i < 200; i += 1) {
    const before = game.state.active?.pos.y
    game.tick(SOFT_DROP_INTERVAL_MS + 5)
    const after = game.state.active?.pos.y
    if (after === undefined || after === before) break
  }
  game.apply({ type: 'softDropEnd' })
}

/** 現在のピースを左端に寄せてから、指定列ぶん右に動かしてハードドロップする。 */
function dropAtColumn(game: Game, offset: number): void {
  for (let i = 0; i < 12; i += 1) game.apply({ type: 'moveLeft' })
  for (let i = 0; i < offset; i += 1) game.apply({ type: 'moveRight' })
  game.apply({ type: 'hardDrop' })
}

/**
 * 積み上がった盤面の良さ。完成した行を最優先し、穴と高さを嫌う。
 * 賢さは要らない — 「放っておくと行が消える」程度に置ければ十分。
 */
function evaluate(b: Board): number {
  let complete = 0
  let holes = 0
  let heightSum = 0
  for (let y = 0; y < b.height; y += 1) {
    if (b.cells[y]!.every((c) => c !== null)) complete += 1
  }
  for (let x = 0; x < b.width; x += 1) {
    let reachedTop = false
    for (let y = 0; y < b.height; y += 1) {
      const filled = b.cells[y]![x] !== null
      if (filled) {
        if (!reachedTop) {
          reachedTop = true
          heightSum += b.height - y
        }
      } else if (reachedTop) {
        holes += 1
      }
    }
  }
  return complete * 100 - holes * 8 - heightSum * 0.5
}

/**
 * 現在のピースを、いちばんマシな場所に置く。
 *
 * 単純に列を順に掃引して落とすだけでは、隣り合うピースが重なって塔になり、
 * 行が埋まる前に天井へ届いてしまう（実測で48試行中2回しか消えなかった）。
 * 運のよいシードを探すと壊れやすいテストになるので、公開APIだけを使う
 * 簡単な貪欲プレイヤーで「実際に行が消える」状況を確実に作る。
 */
function greedyDrop(game: Game): void {
  const piece = game.state.active
  if (!piece) return
  const board = game.state.board

  let best: { rotation: RotationState; x: number; value: number } | null = null
  for (let r = 0 as RotationState; r < 4; r = (r + 1) as RotationState) {
    for (let x = -2; x <= BOARD_WIDTH; x += 1) {
      const candidate = { kind: piece.kind, rotation: r, pos: { x, y: piece.pos.y } }
      if (!isValidPosition(board, candidate)) continue
      const landed = {
        ...candidate,
        pos: { x, y: candidate.pos.y + dropDistance(board, candidate) },
      }
      const value = evaluate(lockPiece(board, landed))
      if (!best || value > best.value) best = { rotation: r, x, value }
    }
  }
  if (!best) {
    game.apply({ type: 'hardDrop' })
    return
  }

  for (let i = 0; i < best.rotation; i += 1) game.apply({ type: 'rotateCW' })
  // 回転でキックが働くと x がずれるので、実測値を見ながら寄せる
  for (let i = 0; i < BOARD_WIDTH * 2; i += 1) {
    const current: number | undefined = game.state.active?.pos.x
    if (current === undefined || current === best.x) break
    game.apply({ type: current < best.x ? 'moveRight' : 'moveLeft' })
    if (game.state.active?.pos.x === current) break // 壁で動けない
  }
  game.apply({ type: 'hardDrop' })
}

describe('createGame の初期状態', () => {
  it('URLを開いた直後から遊べる状態で、シードが公開されている', () => {
    const game = createGame({ seed: 12345 })
    const s = game.state
    expect(s.phase).toBe('playing')
    expect(s.active).not.toBeNull()
    expect(s.active?.pos.y).toBe(SPAWN_ORIGIN_Y)
    expect(s.next).toBeTruthy()
    expect(s.hold).toBeNull()
    expect(s.canHold).toBe(true)
    expect(s.score).toBe(0)
    expect(s.lines).toBe(0)
    expect(s.level).toBe(1)
    expect(s.seed).toBe(12345)
  })

  it('保存済みの自己ベストを引き継ぐ', () => {
    expect(createGame({ seed: 1, highScore: 4200 }).state.highScore).toBe(4200)
  })
})

describe('tick — 自然落下とロック猶予', () => {
  it('レベル1では1000msで1マス落ちる', () => {
    const game = createGame({ seed: 7 })
    const before = game.state.active!.pos.y
    game.tick(1000)
    expect(game.state.active!.pos.y).toBe(before + 1)
  })

  it('ソフトドロップ中は速く落ち、落ちた分だけ加点される', () => {
    const fast = createGame({ seed: 7 })
    fast.apply({ type: 'softDropStart' })
    run(fast, 500)
    const slow = createGame({ seed: 7 })
    run(slow, 500)
    expect(fast.state.active!.pos.y).toBeGreaterThan(slow.state.active!.pos.y)
    expect(fast.state.score).toBeGreaterThan(0)
    expect(slow.state.score).toBe(0)
  })

  it('着地してもロック猶予の間は固定されない', () => {
    const game = createGame({ seed: 7 })
    fallUntilGrounded(game)
    const grounded = game.state.active!
    expect(grounded.pos.y).toBeGreaterThan(SPAWN_ORIGIN_Y)
    // 猶予未満では同じピースが同じ位置に留まる
    game.tick(LOCK_DELAY_MS - 100)
    expect(game.state.active!.pos.y).toBe(grounded.pos.y)
    expect(game.state.active!.kind).toBe(grounded.kind)
  })

  it('ロック猶予を過ぎると固定され、次のピースが出現する', () => {
    const game = createGame({ seed: 7 })
    const first = game.state.active!.kind
    const queued = game.state.next
    fallUntilGrounded(game)
    game.tick(LOCK_DELAY_MS)
    expect(game.state.active!.pos.y).toBe(SPAWN_ORIGIN_Y)
    expect(game.state.active!.kind).toBe(queued)
    expect(game.state.next).not.toBe(undefined)
    // 固定されたピースが盤面に残っている
    const filled = game.state.board.cells.flat().filter((c) => c !== null)
    expect(filled).toHaveLength(4)
    expect(filled.every((c) => c === first)).toBe(true)
  })

  it('ポーズ中は時間が進まない', () => {
    const game = createGame({ seed: 7 })
    game.apply({ type: 'togglePause' })
    expect(game.state.phase).toBe('paused')
    const before = game.state.active!.pos.y
    game.tick(5000)
    expect(game.state.active!.pos.y).toBe(before)
    game.apply({ type: 'togglePause' })
    game.tick(1000)
    expect(game.state.active!.pos.y).toBe(before + 1)
  })
})

describe('apply — 操作', () => {
  it('左右に動き、壁を越えない', () => {
    const game = createGame({ seed: 3 })
    const start = game.state.active!.pos.x
    game.apply({ type: 'moveLeft' })
    expect(game.state.active!.pos.x).toBe(start - 1)
    game.apply({ type: 'moveRight' })
    expect(game.state.active!.pos.x).toBe(start)
    for (let i = 0; i < 30; i += 1) game.apply({ type: 'moveLeft' })
    const leftmost = game.state.active!.pos.x
    game.apply({ type: 'moveLeft' })
    expect(game.state.active!.pos.x).toBe(leftmost)
  })

  it('右回転と左回転で回転状態が巡回する', () => {
    const game = createGame({ seed: 3 })
    const r0 = game.state.active!.rotation
    game.apply({ type: 'rotateCW' })
    expect(game.state.active!.rotation).toBe((r0 + 1) % 4)
    game.apply({ type: 'rotateCCW' })
    expect(game.state.active!.rotation).toBe(r0)
    game.apply({ type: 'rotateCCW' })
    expect(game.state.active!.rotation).toBe((r0 + 3) % 4)
  })

  it('ハードドロップは一気に着地して即座に固定し、落下距離ぶん加点する', () => {
    const game = createGame({ seed: 3 })
    const queued = game.state.next
    game.apply({ type: 'hardDrop' })
    expect(game.state.score).toBeGreaterThan(0)
    expect(game.state.active!.kind).toBe(queued)
    expect(game.state.active!.pos.y).toBe(SPAWN_ORIGIN_Y)
    expect(game.state.board.cells.flat().filter((c) => c !== null)).toHaveLength(4)
  })

  it('ホールドは1回の落下につき1度だけ効き、固定すると再び使える', () => {
    const game = createGame({ seed: 3 })
    const first = game.state.active!.kind
    const queued = game.state.next

    game.apply({ type: 'hold' })
    expect(game.state.hold).toBe(first)
    expect(game.state.active!.kind).toBe(queued)
    expect(game.state.canHold).toBe(false)

    // 2度目は無視される
    const held = game.state.hold
    const onBoard = game.state.active!.kind
    game.apply({ type: 'hold' })
    expect(game.state.hold).toBe(held)
    expect(game.state.active!.kind).toBe(onBoard)

    // 固定すると再び使える
    game.apply({ type: 'hardDrop' })
    expect(game.state.canHold).toBe(true)

    // 2回目のホールドは、保持していたピースと入れ替わる
    const current = game.state.active!.kind
    game.apply({ type: 'hold' })
    expect(game.state.hold).toBe(current)
    expect(game.state.active!.kind).toBe(first)
  })

  it('ゲームオーバー後は操作を受け付けない', () => {
    const game = createGame({ seed: 3 })
    for (let i = 0; i < 400 && game.state.phase === 'playing'; i += 1) dropAtColumn(game, 0)
    expect(game.state.phase).toBe('gameover')
    expect(game.state.active).toBeNull()
    const snapshot = game.state.score
    game.apply({ type: 'moveLeft' })
    game.apply({ type: 'rotateCW' })
    game.apply({ type: 'hardDrop' })
    game.tick(5000)
    expect(game.state.score).toBe(snapshot)
    expect(game.state.phase).toBe('gameover')
  })

  it('ゲームオーバー時に自己ベストが更新される', () => {
    const game = createGame({ seed: 3, highScore: 0 })
    for (let i = 0; i < 400 && game.state.phase === 'playing'; i += 1) dropAtColumn(game, 0)
    expect(game.state.highScore).toBe(game.state.score)
  })
})

describe('ライン消去とレベル', () => {
  it('列が埋まると消えて加点され、累計行数が増える', () => {
    const game = createGame({ seed: 99 })
    for (let i = 0; i < 40 && game.state.phase === 'playing' && game.state.lines === 0; i += 1) {
      greedyDrop(game)
    }
    expect(game.state.phase).toBe('playing')
    expect(game.state.lines).toBeGreaterThan(0)
    expect(game.state.score).toBeGreaterThan(0)
  })

  it('10行消すごとにレベルが上がり、落下が速くなる', () => {
    const game = createGame({ seed: 99 })
    expect(game.state.level).toBe(1)
    for (let i = 0; i < 400 && game.state.phase === 'playing' && game.state.lines < 10; i += 1) {
      greedyDrop(game)
    }
    expect(game.state.lines).toBeGreaterThanOrEqual(10)
    expect(game.state.level).toBeGreaterThanOrEqual(2)
  })

  it('可視領域より高く積めない（ゲームオーバーで止まる）', () => {
    const game = createGame({ seed: 5 })
    for (let i = 0; i < 500 && game.state.phase === 'playing'; i += 1) dropAtColumn(game, 0)
    expect(game.state.phase).toBe('gameover')
    const stackHeight = game.state.board.cells.filter((row) => row.some((c) => c !== null)).length
    expect(stackHeight).toBeLessThanOrEqual(VISIBLE_ROWS + 2)
  })
})

describe('決定性 — 不具合の再現がこれで成立する', () => {
  const script: Action[] = [
    { type: 'moveLeft' }, { type: 'rotateCW' }, { type: 'hardDrop' },
    { type: 'moveRight' }, { type: 'moveRight' }, { type: 'rotateCCW' }, { type: 'hardDrop' },
    { type: 'hold' }, { type: 'softDropStart' },
  ]

  function play(seed: number): unknown {
    const game = createGame({ seed })
    for (const action of script) game.apply(action)
    run(game, 3000)
    for (let i = 0; i < 20; i += 1) dropAtColumn(game, i % 7)
    const s = game.state
    return {
      score: s.score, lines: s.lines, level: s.level, phase: s.phase,
      hold: s.hold, next: s.next, seed: s.seed,
      cells: s.board.cells.map((row) => row.join(',')),
    }
  }

  it('同じシードに同じ操作列を流すと、盤面まで完全に一致する', () => {
    expect(play(2024)).toEqual(play(2024))
  })

  it('シードが違えば展開が変わる', () => {
    expect(play(2024)).not.toEqual(play(9999))
  })

  it('リスタートすると盤面が初期化され、次の局は別の展開になる', () => {
    const game = createGame({ seed: 777 })
    for (let i = 0; i < 10; i += 1) dropAtColumn(game, i % 7)
    expect(game.state.score).toBeGreaterThan(0)

    game.apply({ type: 'restart' })
    const s = game.state
    expect(s.phase).toBe('playing')
    expect(s.score).toBe(0)
    expect(s.lines).toBe(0)
    expect(s.hold).toBeNull()
    expect(s.board.cells.flat().every((c) => c === null)).toBe(true)
    expect(s.seed).not.toBe(777)
  })

  it('リスタートしても自己ベストは残る', () => {
    const game = createGame({ seed: 777 })
    for (let i = 0; i < 400 && game.state.phase === 'playing'; i += 1) dropAtColumn(game, 0)
    const best = game.state.highScore
    expect(best).toBeGreaterThan(0)
    game.apply({ type: 'restart' })
    expect(game.state.highScore).toBe(best)
  })
})
