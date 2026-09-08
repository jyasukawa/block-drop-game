/**
 * 配線とゲームループ。
 *
 * core は時間も乱数も自分では取らない設計なので、そのどちらもここで用意して渡す。
 * 「非決定的なものは全部ここに集める」ことで、core をテスト可能に保っている。
 */
import './style.css'
import { MAX_FRAME_DELTA_MS } from './core/constants'
import { createGame } from './core/game'
import type { InputSource } from './platform/input'
import { createKeyboardInput } from './platform/input-keyboard'
import { createButtonInput, createTouchInput } from './platform/input-touch'
import { createRenderer } from './platform/render'
import { createHighScoreStore } from './platform/storage'
import { DOM_IDS } from './core/constants'

/**
 * この局のシード。`core` は `Date.now` / `Math.random` を触れないので platform 層で作る。
 * 生成した値は `GameState.seed` として画面から辿れるので、あとから同じ局を再現できる。
 */
function createSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000)) >>> 0
}

function requireElement<T extends Element>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id)
  if (!(el instanceof ctor)) throw new Error(`#${id} が見つからない、または想定と型が違う`)
  return el
}

function main(): void {
  const store = createHighScoreStore()
  const game = createGame({ seed: createSeed(), highScore: store.load() })
  const renderer = createRenderer()

  const boardCanvas = requireElement(DOM_IDS.board, HTMLCanvasElement)
  const sources: InputSource[] = [
    createKeyboardInput(window),
    createTouchInput(boardCanvas),
    createButtonInput(),
  ]

  // 保存済みの値を覚えておき、更新されたときだけ書く。
  // 毎フレーム localStorage に書くとメインスレッドを無駄に止める。
  let savedHighScore = game.state.highScore

  let previous = performance.now()

  function frame(now: number): void {
    // タブが非アクティブだった間の巨大な差分をそのまま渡すと、復帰した瞬間に
    // 何十マスも落ちてゲームオーバーになる。上限で切り捨てる。
    const delta = Math.min(now - previous, MAX_FRAME_DELTA_MS)
    previous = now

    for (const source of sources) {
      source.tick(delta)
      for (const action of source.drain()) game.apply(action)
    }
    game.tick(delta)

    const state = game.state
    if (state.highScore > savedHighScore) {
      savedHighScore = state.highScore
      store.save(savedHighScore)
    }
    renderer.draw(state)

    requestAnimationFrame(frame)
  }

  // window の resize だけでは足りない。iOS のアドレスバー伸縮やソフトキーボードでは
  // visualViewport の resize しか飛ばないことがあり、orientationchange の直後は
  // 寸法がまだ確定していないので次フレームまで待つ。
  const relayout = (): void => {
    renderer.resize()
    renderer.draw(game.state)
  }
  window.addEventListener('resize', relayout)
  window.visualViewport?.addEventListener('resize', relayout)
  window.addEventListener('orientationchange', () => {
    requestAnimationFrame(relayout)
  })

  requestAnimationFrame(frame)
}

main()
