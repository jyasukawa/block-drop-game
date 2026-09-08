/**
 * キーボード入力を Action に翻訳する。
 *
 * ── Phase 4-B の担当ファイル。シグネチャは契約なので変更しないこと。
 */
import { ARR_MS, DAS_MS } from '../core/constants'
import type { Action } from '../core/types'
import { createActionQueue } from './input'
import type { InputSource } from './input'

/** 長押しで連続移動する対象。左右だけが DAS/ARR を持つ。 */
type HorizontalType = 'moveLeft' | 'moveRight'

/**
 * キーと Action の対応。index.html の操作説明と一致させること。
 *
 * 添字は `event.key` を小文字化したもの。`event.code` を使わないのは、
 * 説明文に書いてあるのは刻印（Z / C / P / R）であり、配列が変わっても
 * 刻印どおりのキーで動くほうが説明と食い違わないため。
 */
const KEY_TO_TYPE: Readonly<Record<string, Action['type']>> = {
  arrowleft: 'moveLeft',
  arrowright: 'moveRight',
  arrowup: 'rotateCW',
  z: 'rotateCCW',
  // ↓ は押している間だけソフトドロップなので、離したときに End を送る（下記 keyup 側）。
  arrowdown: 'softDropStart',
  ' ': 'hardDrop',
  c: 'hold',
  p: 'togglePause',
  r: 'restart',
}

/**
 * ブラウザ既定の動作を止めるキー。
 * 矢印と Space はページをスクロールさせるので、遊んでいる間ずっと画面が飛び跳ねる。
 */
const SCROLLING_KEYS: ReadonlySet<string> = new Set([
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown',
  ' ',
])

/** `target` にリスナを張る。通常は `window`。 */
export function createKeyboardInput(target: Window): InputSource {
  const queue = createActionQueue()

  /**
   * 押されているキー。OS のキーリピートは `event.repeat` で弾けるが、それに加えて
   * ここでも二重押下を落としている。回転やハードドロップが1押下1回であることは
   * `event.repeat` の挙動に依存させたくない（環境差が出る部分なので）。
   */
  const pressed = new Set<string>()

  /**
   * 押されている左右キーを押した順に積む。同時押しは後から押したほうが有効で、
   * それを離したら残っているほうへ戻る。これが無いと素早い切り返しで入力が詰まる。
   */
  const horizontalStack: HorizontalType[] = []

  /** 有効な方向の経過時間。DAS 待ちと ARR の刻みで意味が変わる。 */
  let elapsedMs = 0
  /** DAS を過ぎて連続移動に入っているか。 */
  let repeating = false

  function activeHorizontal(): HorizontalType | null {
    return horizontalStack[horizontalStack.length - 1] ?? null
  }

  /** 方向が切り替わった（または押された）ときの起点。1回目は待たずに出す。 */
  function beginHorizontal(type: HorizontalType): void {
    queue.push({ type })
    elapsedMs = 0
    repeating = false
  }

  function releaseHorizontal(type: HorizontalType): void {
    const before = activeHorizontal()
    const index = horizontalStack.lastIndexOf(type)
    if (index >= 0) horizontalStack.splice(index, 1)
    const after = activeHorizontal()
    // 有効でないほうを離しただけなら、動いている側の DAS を巻き戻さない。
    if (after !== null && after !== before) beginHorizontal(after)
  }

  /** 押下状態を捨てる。押されたままだと思い込んだキーを残さないため。 */
  function resetPressed(): void {
    // blur 中に離された ↓ は keyup が来ないので、ここで必ず End を出す。
    // 出さないと復帰後もソフトドロップが続いたままになる。
    if (pressed.has('arrowdown')) queue.push({ type: 'softDropEnd' })
    pressed.clear()
    horizontalStack.length = 0
    elapsedMs = 0
    repeating = false
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase()
    // repeat や二重押下で return する前に止める。ここを後回しにするとスクロールが漏れる。
    if (SCROLLING_KEYS.has(key)) event.preventDefault()

    // OS 側の自動連打は捨てる。DAS/ARR を自前で持っているので通すと二重に効く。
    if (event.repeat) return
    if (pressed.has(key)) return

    const type = KEY_TO_TYPE[key]
    if (type === undefined) return
    pressed.add(key)

    if (type === 'moveLeft' || type === 'moveRight') {
      horizontalStack.push(type)
      beginHorizontal(type)
      return
    }
    queue.push({ type })
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase()
    if (SCROLLING_KEYS.has(key)) event.preventDefault()
    if (!pressed.delete(key)) return

    const type = KEY_TO_TYPE[key]
    if (type === undefined) return

    if (type === 'moveLeft' || type === 'moveRight') {
      releaseHorizontal(type)
      return
    }
    if (type === 'softDropStart') queue.push({ type: 'softDropEnd' })
  }

  const onBlur = (): void => {
    resetPressed()
  }

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  target.addEventListener('blur', onBlur)

  return {
    tick(deltaMs) {
      const type = activeHorizontal()
      if (type === null) return

      elapsedMs += deltaMs
      if (!repeating) {
        if (elapsedMs < DAS_MS) return
        // 端数は次の ARR に持ち越す。切り捨てるとフレーム長に応じて連続移動が遅れる。
        elapsedMs -= DAS_MS
        repeating = true
        queue.push({ type })
      }

      // ARR_MS を 0 に調整されても while が終わらないよう最低 1ms として扱う。
      const arrMs = Math.max(ARR_MS, 1)
      while (elapsedMs >= arrMs) {
        elapsedMs -= arrMs
        queue.push({ type })
      }
    },
    drain() {
      return queue.drain()
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown)
      target.removeEventListener('keyup', onKeyUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}
