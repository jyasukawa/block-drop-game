/**
 * ゲームの状態機械。core の各モジュールを束ねて「遊べる状態」にする。
 *
 * ここだけが可変な状態を持つ。外へは読み取り専用の `GameState` として見せる。
 * 盤面やピースを不変にしてあるのは、この1箇所に変化を閉じ込めるためで、
 * 描画や保存の側が状態を書き換えてしまう経路を作らないようにしている。
 *
 * 時間は `tick(deltaMs)` の引数で受け取り、乱数はシードから作る。
 * `Date.now` も `Math.random` も呼ばないので、同じシードに同じ操作列を流せば
 * 必ず同じ結果になる。不具合の再現がこれで成立する。
 */
import type { Action, ActivePiece, Board, GameState, Phase, PieceKind, Randomizer } from './types'
import {
  BOARD_HEIGHT,
  LOCK_DELAY_MS,
  LOCK_RESET_LIMIT,
  SOFT_DROP_INTERVAL_MS,
} from './constants'
import { clearLines, createEmptyBoard, dropDistance, isValidPosition, lockPiece } from './board'
import { spawnPosition } from './pieces'
import { createBagRandomizer, createSeededRng } from './randomizer'
import { dropIntervalMs, hardDropScore, levelFor, lineClearScore, softDropScore } from './scoring'
import { tryRotate } from './srs'

export interface GameOptions {
  /** この局のピース順を決める種。同じ値なら同じ順序になる。 */
  readonly seed: number
  /** 保存済みの自己ベスト。無ければ 0 から。 */
  readonly highScore?: number | undefined
}

export interface Game {
  /** 現在の状態のスナップショット。呼ぶたびに組み立てられる。 */
  readonly state: GameState
  /** 経過時間を進める。自然落下・ロック猶予の判定はここで行う。 */
  tick(deltaMs: number): void
  /** 操作を反映する。入力デバイスの違いは呼び出し側で吸収済み。 */
  apply(action: Action): void
}

/**
 * 1ティックで処理する落下の上限。
 * タブ復帰などで巨大な `deltaMs` が来ても、盤面の高さを超えて落ちることはない。
 * それでも保険として上限を置き、万一の無限ループでブラウザが固まるのを防ぐ。
 */
const MAX_DROPS_PER_TICK = BOARD_HEIGHT + 4

/**
 * リスタート時の次のシードを、現在のシードから決定的に導く。
 *
 * 同じシードで再開すると毎回まったく同じ局になってしまい、遊べたものではない。
 * かといって `Date.now()` を使うと core が非決定的になる。
 * そこで現在のシードから次を導くことで、「最初のシード1つでセッション全体が再現できる」
 * 性質を保ったまま、局ごとに違う展開にしている。
 */
function deriveNextSeed(seed: number): number {
  return Math.floor(createSeededRng(seed)() * 0x1_0000_0000) >>> 0
}

export function createGame(options: GameOptions): Game {
  let seed = options.seed >>> 0
  let highScore = options.highScore ?? 0

  let randomizer: Randomizer
  let board: Board
  let active: ActivePiece | null
  let next: PieceKind
  let hold: PieceKind | null
  let canHold: boolean
  let score: number
  let lines: number
  let phase: Phase

  /** 次の自然落下までに溜まった時間。 */
  let dropTimer: number
  /** 着地してから経過した時間。 */
  let lockTimer: number
  /** 猶予をリセットした回数。上限を設けないと回し続けて永久に落ちない。 */
  let lockResets: number
  let softDropping: boolean

  function level(): number {
    return levelFor(lines)
  }

  function moved(piece: ActivePiece, dx: number, dy: number): ActivePiece {
    return { ...piece, pos: { x: piece.pos.x + dx, y: piece.pos.y + dy } }
  }

  function isGrounded(): boolean {
    return active !== null && !isValidPosition(board, moved(active, 0, 1))
  }

  /** 指定した種類のピースを出現位置に出す。置けなければゲームオーバー。 */
  function spawnKind(kind: PieceKind): void {
    const piece: ActivePiece = { kind, rotation: 0, pos: spawnPosition() }
    dropTimer = 0
    lockTimer = 0
    lockResets = 0
    if (!isValidPosition(board, piece)) {
      active = null
      phase = 'gameover'
      if (score > highScore) highScore = score
      return
    }
    active = piece
  }

  /** ネクストを消費して出現させ、ネクストを補充する。 */
  function spawnFromQueue(): void {
    const kind = next
    next = randomizer.next()
    spawnKind(kind)
  }

  /**
   * 着地後の移動・回転で猶予をリセットする。
   * 上限に達したらリセットしない — そうしないと回転し続けるだけで無限に粘れてしまう。
   */
  function touchLockTimer(): void {
    if (!isGrounded()) return
    if (lockResets >= LOCK_RESET_LIMIT) return
    lockResets += 1
    lockTimer = 0
  }

  /** 現在のピースを盤面に固定し、ライン消去と加点を行って次を出す。 */
  function lockCurrent(): void {
    if (!active) return
    board = lockPiece(board, active)
    const result = clearLines(board)
    if (result.cleared > 0) {
      // レベル倍率は「消す前」のレベルで掛ける。消した瞬間にレベルが上がって
      // 同じ操作の点数が変わると、加点の理屈が説明できなくなるため。
      score += lineClearScore(result.cleared, level())
      board = result.board
      lines += result.cleared
    }
    active = null
    canHold = true
    spawnFromQueue()
  }

  /** 1マス落とす。落とせたら true、着地していたら false。 */
  function stepDown(): boolean {
    if (!active) return false
    const down = moved(active, 0, 1)
    if (!isValidPosition(board, down)) return false
    active = down
    lockTimer = 0
    if (softDropping) score += softDropScore(1)
    return true
  }

  function reset(): void {
    randomizer = createBagRandomizer(createSeededRng(seed))
    board = createEmptyBoard()
    hold = null
    canHold = true
    score = 0
    lines = 0
    phase = 'playing'
    dropTimer = 0
    lockTimer = 0
    lockResets = 0
    softDropping = false
    next = randomizer.next()
    spawnFromQueue()
  }

  function tick(deltaMs: number): void {
    if (phase !== 'playing' || !active) return
    const dt = Math.max(0, deltaMs)

    dropTimer += dt
    for (let i = 0; i < MAX_DROPS_PER_TICK; i += 1) {
      // レベルは落下中に上がりうるので、毎回引き直す。
      const interval = softDropping ? SOFT_DROP_INTERVAL_MS : dropIntervalMs(level())
      if (dropTimer < interval) break
      dropTimer -= interval
      if (!stepDown()) {
        // 着地しているならこれ以上落ちない。溜まった分は捨てる。
        // 残しておくと、崖から横に滑り出した瞬間に一気に落ちてしまう。
        dropTimer = 0
        break
      }
    }

    if (isGrounded()) {
      lockTimer += dt
      if (lockTimer >= LOCK_DELAY_MS) lockCurrent()
    } else {
      lockTimer = 0
    }
  }

  /** 局そのものを操作するもの。ゲームオーバー中やポーズ中でも効く。 */
  function apply(action: Action): void {
    if (action.type === 'restart') {
      seed = deriveNextSeed(seed)
      reset()
      return
    }
    if (action.type === 'togglePause') {
      if (phase === 'playing') phase = 'paused'
      else if (phase === 'paused') phase = 'playing'
      return
    }
    if (phase !== 'playing' || active === null) return
    applyPlayAction(action, active)
  }

  /**
   * 盤上のピースを動かす操作。
   *
   * 引数の型から restart / togglePause を除いてあるので、`default` の never 代入が
   * 網羅性チェックとして働く。操作を1つ増やしてここに書き忘れると型エラーになる
   * — 実際に `hold` の実装を落としたまま型チェックが通ってしまったので、その再発を防いでいる。
   */
  function applyPlayAction(
    action: Exclude<Action, { type: 'restart' } | { type: 'togglePause' }>,
    piece: ActivePiece,
  ): void {
    switch (action.type) {
      case 'moveLeft':
      case 'moveRight': {
        const candidate = moved(piece, action.type === 'moveLeft' ? -1 : 1, 0)
        if (isValidPosition(board, candidate)) {
          active = candidate
          touchLockTimer()
        }
        break
      }
      case 'rotateCW':
      case 'rotateCCW': {
        const dir = action.type === 'rotateCW' ? 1 : -1
        const rotated = tryRotate(piece, dir, (p) => isValidPosition(board, p))
        if (rotated) {
          active = rotated
          touchLockTimer()
        }
        break
      }
      case 'softDropStart':
        softDropping = true
        break
      case 'softDropEnd':
        softDropping = false
        break
      case 'hardDrop': {
        const distance = dropDistance(board, piece)
        if (distance > 0) {
          active = moved(piece, 0, distance)
          score += hardDropScore(distance)
        }
        // ハードドロップは猶予を与えず即座に固定する。
        // ここで猶予を挟むと「一気に落とした」感覚と挙動が食い違う。
        lockCurrent()
        break
      }
      case 'hold': {
        // ホールドは1回の落下につき1度まで。無制限だと2種を延々入れ替えられてしまう。
        if (!canHold) break
        const stored = hold
        hold = piece.kind
        canHold = false
        if (stored === null) spawnFromQueue()
        else spawnKind(stored)
        break
      }
      default: {
        const exhaustive: never = action
        void exhaustive
      }
    }
  }

  reset()

  return {
    get state(): GameState {
      return {
        board,
        active,
        next,
        hold,
        canHold,
        score,
        lines,
        level: level(),
        phase,
        highScore,
        seed,
      }
    },
    tick,
    apply,
  }
}
