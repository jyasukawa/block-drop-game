/**
 * タッチ操作と画面上のボタンを Action に翻訳する。
 *
 * ── Phase 4-C の担当ファイル。シグネチャは契約なので変更しないこと。
 */
import {
  DOM_IDS,
  TOUCH_FLICK_MAX_MS,
  TOUCH_FLICK_MIN_PX,
  TOUCH_MOVE_CELL_PX,
  TOUCH_SOFT_DROP_CELL_PX,
  TOUCH_TAP_MAX_MS,
  TOUCH_TAP_MAX_PX,
} from '../core/constants'
import type { Action } from '../core/types'
import { createActionQueue } from './input'
import type { InputSource } from './input'

/**
 * 追跡中の指。
 *
 * 2本目以降は見ないので常に高々1つ。マルチタッチを解釈しようとすると、
 * 「盤面を持ち替えた指」と「操作の指」を取り違えて1本目の追跡が乱れる。
 * 操作は全部1本指で足りるので、最初に触れた指だけを最後まで追う。
 */
interface Tracked {
  readonly id: number
  readonly startX: number
  readonly startY: number
  readonly startedAt: number
  /** 横の基準点。1セル送るたびに閾値分ずらし、指に追従させ続ける。 */
  anchorX: number
  /** 下方向の基準点。同上。 */
  anchorY: number
  /** 開始点から最も離れた距離。行って戻る動きをタップと誤認しないために最大値で持つ。 */
  maxDistance: number
  /** ソフトドロップを開始済みか。離したときに End を出すかの判断に使う。 */
  softDropping: boolean
  /** ハードドロップ済みの印。1回のジェスチャで2度落とさないため。 */
  consumed: boolean
}

/** `surface` の上でのタッチジェスチャを解釈する。通常は盤面の canvas。 */
export function createTouchInput(surface: HTMLElement): InputSource {
  const queue = createActionQueue()
  let tracked: Tracked | null = null

  function findTouch(list: TouchList, id: number): Touch | null {
    for (let i = 0; i < list.length; i += 1) {
      const touch = list.item(i)
      if (touch !== null && touch.identifier === id) return touch
    }
    return null
  }

  /** ソフトドロップを閉じる。押しっぱなし扱いが次のピースに残らないように。 */
  function endSoftDrop(state: Tracked): void {
    if (!state.softDropping) return
    state.softDropping = false
    queue.push({ type: 'softDropEnd' })
  }

  const onTouchStart = (event: TouchEvent): void => {
    // ページのスクロールとピンチズームを止める。style.css の touch-action だけでは
    // iOS Safari の既定動作を抑えきれず、スワイプが操作ではなくページの引っ張りになる。
    event.preventDefault()
    // 追跡中に増えた指は無視する。ここで乗り換えると1本目の基準点が飛ぶ。
    if (tracked !== null) return

    const touch = event.changedTouches.item(0)
    if (touch === null) return
    tracked = {
      id: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      // イベントの timeStamp は基準時刻がブラウザ差のある値なので、単調な時計に揃える。
      startedAt: performance.now(),
      anchorX: touch.clientX,
      anchorY: touch.clientY,
      maxDistance: 0,
      softDropping: false,
      consumed: false,
    }
  }

  const onTouchMove = (event: TouchEvent): void => {
    event.preventDefault()
    const state = tracked
    if (state === null) return
    const touch = findTouch(event.changedTouches, state.id)
    if (touch === null) return

    const dx = touch.clientX - state.startX
    const dy = touch.clientY - state.startY
    state.maxDistance = Math.max(state.maxDistance, Math.hypot(dx, dy))

    // ハードドロップ済みの指は離すまで何もしない。落とした直後の指の流れが
    // 次のピースを動かすと、狙っていない場所に置かれてしまう。
    if (state.consumed) return

    // 横は縦と独立に見る。斜めに動いても横成分は素直に追従したほうが操作しやすい。
    // 基準点を閾値ぶんずつ進めることで、動かし続ければそのまま連続移動になる。
    while (touch.clientX - state.anchorX >= TOUCH_MOVE_CELL_PX) {
      state.anchorX += TOUCH_MOVE_CELL_PX
      queue.push({ type: 'moveRight' })
    }
    while (state.anchorX - touch.clientX >= TOUCH_MOVE_CELL_PX) {
      state.anchorX -= TOUCH_MOVE_CELL_PX
      queue.push({ type: 'moveLeft' })
    }

    // 縦の判定順は フリック → ソフトドロップ。逆にすると、速い下スワイプが
    // 途中でソフトドロップに食われ、ハードドロップが出せなくなる。
    // 判定は開始点からの距離と時間で見る（y は下が正なので、下スワイプは dy > 0）。
    if (dy >= TOUCH_FLICK_MIN_PX && performance.now() - state.startedAt <= TOUCH_FLICK_MAX_MS) {
      endSoftDrop(state)
      queue.push({ type: 'hardDrop' })
      state.consumed = true
      return
    }

    // 指を上に戻したら基準も戻す。戻した分が次の下方向に加算されると、
    // わずかに下げただけでソフトドロップが復活してしまう。
    if (touch.clientY < state.anchorY) state.anchorY = touch.clientY
    while (touch.clientY - state.anchorY >= TOUCH_SOFT_DROP_CELL_PX) {
      state.anchorY += TOUCH_SOFT_DROP_CELL_PX
      // Action には「1セル分落とす」が無く、あるのは落下速度の切り替えだけ。
      // 閾値を越えた時点でソフトドロップに入り、離すまで続ける形に寄せている。
      if (!state.softDropping) {
        state.softDropping = true
        queue.push({ type: 'softDropStart' })
      }
    }
  }

  const onTouchEnd = (event: TouchEvent): void => {
    // 合成 click とダブルタップズームを抑える。連打で画面が拡大すると操作不能になる。
    event.preventDefault()
    const state = tracked
    if (state === null) return
    if (findTouch(event.changedTouches, state.id) === null) return

    endSoftDrop(state)
    // タップ判定は最後。移動もフリックも成立しなかったときだけ残る操作なので、
    // 「短い時間・小さい移動」の両方を満たすことを条件にする。
    if (
      !state.consumed &&
      state.maxDistance <= TOUCH_TAP_MAX_PX &&
      performance.now() - state.startedAt <= TOUCH_TAP_MAX_MS
    ) {
      queue.push({ type: 'rotateCW' })
    }
    tracked = null
  }

  const onTouchCancel = (event: TouchEvent): void => {
    const state = tracked
    if (state === null) return
    if (findTouch(event.changedTouches, state.id) === null) return
    // 着信などで中断されたとき、ソフトドロップが立ったまま残ると
    // 指を離していないのに落ち続ける。中断でも必ず閉じる。
    endSoftDrop(state)
    tracked = null
  }

  // passive: false を明示しないと、Chrome は touchstart/touchmove を passive 扱いにして
  // preventDefault を無視する。スクロール抑止はここに懸かっている。
  const options: AddEventListenerOptions = { passive: false }
  surface.addEventListener('touchstart', onTouchStart, options)
  surface.addEventListener('touchmove', onTouchMove, options)
  surface.addEventListener('touchend', onTouchEnd, options)
  surface.addEventListener('touchcancel', onTouchCancel, options)

  return {
    tick(): void {
      // 時間依存の判定はイベント側で完結している（フリックの制限時間は
      // touchmove の時点で測れる）ので、ここですることは無い。
    },
    drain() {
      return queue.drain()
    },
    dispose() {
      surface.removeEventListener('touchstart', onTouchStart, options)
      surface.removeEventListener('touchmove', onTouchMove, options)
      surface.removeEventListener('touchend', onTouchEnd, options)
      surface.removeEventListener('touchcancel', onTouchCancel, options)
    },
  }
}

/** ボタンの id と、押されたときに出す操作。 */
const BUTTON_ACTIONS: readonly (readonly [id: string, action: Action])[] = [
  [DOM_IDS.btnHold, { type: 'hold' }],
  [DOM_IDS.btnPause, { type: 'togglePause' }],
  [DOM_IDS.btnRestart, { type: 'restart' }],
]

/**
 * 画面上の HOLD / PAUSE / RESTART ボタン。
 * マウスでも押せるので、タッチ端末に限らず有効にしておく。
 */
export function createButtonInput(): InputSource {
  const queue = createActionQueue()
  const bound: { readonly el: HTMLElement; readonly handler: (event: MouseEvent) => void }[] = []

  for (const [id, action] of BUTTON_ACTIONS) {
    const el = document.getElementById(id)
    // ボタンが無い構成でも入力層ごと落とさない。遊べなくなるほうが損失が大きい。
    if (el === null) continue

    const handler = (event: MouseEvent): void => {
      queue.push(action)
      // ポインタで押したときだけフォーカスを外す。押したボタンにフォーカスが残ると、
      // 以降の Space や Enter がゲーム操作ではなくボタンの再実行になってしまう。
      // キーボードで押した場合（detail === 0）は移動先を奪わない。
      if (event.detail > 0) el.blur()
    }
    // click で拾うので、タップでもマウスでも同じ経路になる。
    el.addEventListener('click', handler)
    bound.push({ el, handler })
  }

  return {
    tick(): void {
      // ボタンは押した瞬間に確定するので、時間で変わる状態を持たない。
    },
    drain() {
      return queue.drain()
    },
    dispose() {
      for (const { el, handler } of bound) el.removeEventListener('click', handler)
      bound.length = 0
    },
  }
}
