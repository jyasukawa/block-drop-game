/**
 * input-keyboard のテスト。
 *
 * DAS/ARR は時間に依存するので、目視では「なんとなく効きが悪い」までしか分からない。
 * `tick(deltaMs)` に時間を注入して、境界の1ms 手前と直後を明示的に確かめる。
 *
 * 期待値は constants.ts から導く。数値を書き写すと、操作感の調整のたびに
 * 実装は正しいのにテストだけが赤くなり、調整の邪魔になるため。
 */
import { describe, expect, it } from 'vitest'
import { ARR_MS, DAS_MS } from '../src/core/constants'
import type { Action } from '../src/core/types'
import { createKeyboardInput } from '../src/platform/input-keyboard'

type Listener = (event: unknown) => void

/** テスト用のキーイベント。実装が読むのは key / repeat / preventDefault だけ。 */
interface FakeKeyEvent {
  readonly key: string
  readonly repeat: boolean
  preventDefault(): void
  readonly prevented: boolean
}

function keyEvent(key: string, repeat = false): FakeKeyEvent {
  let prevented = false
  return {
    key,
    repeat,
    preventDefault() {
      prevented = true
    },
    get prevented() {
      return prevented
    },
  }
}

/**
 * `window` の代わり。Vitest の環境が node なので DOM は無い。
 * 実装が使うのは addEventListener / removeEventListener だけなのでそれだけ用意する。
 */
function createFakeWindow() {
  const listeners = new Map<string, Listener[]>()
  const target = {
    addEventListener(type: string, listener: Listener): void {
      const bucket = listeners.get(type) ?? []
      bucket.push(listener)
      listeners.set(type, bucket)
    },
    removeEventListener(type: string, listener: Listener): void {
      const bucket = listeners.get(type)
      if (bucket === undefined) return
      const index = bucket.indexOf(listener)
      if (index >= 0) bucket.splice(index, 1)
    },
  }
  return {
    target: target as unknown as Window,
    /** 張られたままのリスナ総数。dispose の確認に使う。 */
    count(): number {
      let total = 0
      for (const bucket of listeners.values()) total += bucket.length
      return total
    },
    dispatch(type: string, event: unknown): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
    },
  }
}

/** テスト本体を短く保つための操作口。 */
function setup() {
  const fake = createFakeWindow()
  const input = createKeyboardInput(fake.target)
  return {
    input,
    listenerCount: () => fake.count(),
    down(key: string, repeat = false): FakeKeyEvent {
      const event = keyEvent(key, repeat)
      fake.dispatch('keydown', event)
      return event
    },
    up(key: string): FakeKeyEvent {
      const event = keyEvent(key)
      fake.dispatch('keyup', event)
      return event
    },
    blur(): void {
      fake.dispatch('blur', {})
    },
    /** 経過時間を渡してから溜まった Action を取り出す。main.ts と同じ順序。 */
    step(deltaMs: number): Action['type'][] {
      input.tick(deltaMs)
      return input.drain().map((action) => action.type)
    },
    take(): Action['type'][] {
      return input.drain().map((action) => action.type)
    },
  }
}

describe('キー割り当て', () => {
  const cases: ReadonlyArray<readonly [string, Action['type']]> = [
    ['ArrowLeft', 'moveLeft'],
    ['ArrowRight', 'moveRight'],
    ['ArrowUp', 'rotateCW'],
    ['z', 'rotateCCW'],
    ['ArrowDown', 'softDropStart'],
    [' ', 'hardDrop'],
    ['c', 'hold'],
    ['p', 'togglePause'],
    ['r', 'restart'],
  ]

  for (const [key, type] of cases) {
    it(`${key} は ${type} になる`, () => {
      const s = setup()
      s.down(key)
      expect(s.take()).toEqual([type])
    })
  }

  it('大文字でも同じ Action になる（Shift や CapsLock で効かなくならない）', () => {
    const s = setup()
    s.down('Z')
    s.down('C')
    s.down('P')
    s.down('R')
    expect(s.take()).toEqual(['rotateCCW', 'hold', 'togglePause', 'restart'])
  })

  it('割り当てのないキーは無視する', () => {
    const s = setup()
    s.down('a')
    s.up('a')
    expect(s.take()).toEqual([])
  })

  it('↓ を離すと softDropEnd が出る', () => {
    const s = setup()
    s.down('ArrowDown')
    s.up('ArrowDown')
    expect(s.take()).toEqual(['softDropStart', 'softDropEnd'])
  })
})

describe('連射の抑止', () => {
  it('OS のキーリピート（event.repeat）は無視する', () => {
    const s = setup()
    s.down('ArrowLeft')
    expect(s.take()).toEqual(['moveLeft'])
    s.down('ArrowLeft', true)
    s.down('ArrowLeft', true)
    expect(s.take()).toEqual([])
  })

  it('回転・ハードドロップ・ホールドは押しっぱなしでも1回だけ', () => {
    const s = setup()
    for (const key of ['ArrowUp', 'z', ' ', 'c']) {
      s.down(key)
      s.down(key)
      s.down(key)
    }
    expect(s.take()).toEqual(['rotateCW', 'rotateCCW', 'hardDrop', 'hold'])
  })

  it('離してから押し直せばまた出る', () => {
    const s = setup()
    s.down(' ')
    s.up(' ')
    s.down(' ')
    expect(s.take()).toEqual(['hardDrop', 'hardDrop'])
  })

  it('押し続けても ↑ は tick で連続発火しない', () => {
    const s = setup()
    s.down('ArrowUp')
    expect(s.take()).toEqual(['rotateCW'])
    expect(s.step(DAS_MS + ARR_MS * 10)).toEqual([])
  })
})

describe('DAS / ARR', () => {
  it('押した瞬間の1回は待たずに出る', () => {
    const s = setup()
    s.down('ArrowLeft')
    expect(s.take()).toEqual(['moveLeft'])
  })

  it('DAS を過ぎるまでは連続移動しない', () => {
    const s = setup()
    s.down('ArrowLeft')
    s.take()
    expect(s.step(DAS_MS - 1)).toEqual([])
    expect(s.step(1)).toEqual(['moveLeft'])
  })

  it('DAS 後は ARR 間隔で出続ける', () => {
    const s = setup()
    s.down('ArrowRight')
    s.take()
    expect(s.step(DAS_MS)).toEqual(['moveRight'])
    expect(s.step(ARR_MS - 1)).toEqual([])
    expect(s.step(1)).toEqual(['moveRight'])
  })

  it('1回の tick に ARR が複数回入るならその回数だけ出る', () => {
    const s = setup()
    s.down('ArrowLeft')
    s.take()
    s.step(DAS_MS)
    expect(s.step(ARR_MS * 3)).toEqual(['moveLeft', 'moveLeft', 'moveLeft'])
  })

  it('端数は次に持ち越す（フレーム長で連続移動が遅れない）', () => {
    const s = setup()
    s.down('ArrowLeft')
    s.take()
    // DAS をまたぐ tick で余った分は、そのまま ARR の進みに使われる。
    expect(s.step(DAS_MS + ARR_MS)).toEqual(['moveLeft', 'moveLeft'])
  })

  it('離したら連続移動が止まる', () => {
    const s = setup()
    s.down('ArrowLeft')
    s.take()
    s.step(DAS_MS)
    s.up('ArrowLeft')
    s.take()
    expect(s.step(ARR_MS * 5)).toEqual([])
  })

  it('押していないあいだの経過時間は溜まらない', () => {
    const s = setup()
    s.step(DAS_MS * 10)
    s.down('ArrowLeft')
    expect(s.take()).toEqual(['moveLeft'])
    expect(s.step(DAS_MS - 1)).toEqual([])
  })
})

describe('左右同時押し', () => {
  it('後に押したほうが優先される', () => {
    const s = setup()
    s.down('ArrowLeft')
    expect(s.take()).toEqual(['moveLeft'])
    s.down('ArrowRight')
    expect(s.take()).toEqual(['moveRight'])
    expect(s.step(DAS_MS)).toEqual(['moveRight'])
  })

  it('後のほうを離すと、残っているほうの連続移動に切り替わる', () => {
    const s = setup()
    s.down('ArrowLeft')
    s.down('ArrowRight')
    s.take()
    s.step(DAS_MS + ARR_MS * 2)
    s.take()

    s.up('ArrowRight')
    // 切り替わった瞬間に1回出て、そこから DAS を測り直す。
    expect(s.take()).toEqual(['moveLeft'])
    expect(s.step(DAS_MS - 1)).toEqual([])
    expect(s.step(1)).toEqual(['moveLeft'])
  })

  it('有効でないほうを離しても、動いている側の DAS は巻き戻らない', () => {
    const s = setup()
    s.down('ArrowLeft')
    s.down('ArrowRight')
    s.take()
    s.step(DAS_MS - 1)
    s.up('ArrowLeft')
    expect(s.take()).toEqual([])
    expect(s.step(1)).toEqual(['moveRight'])
  })

  it('両方離せば止まる', () => {
    const s = setup()
    s.down('ArrowLeft')
    s.down('ArrowRight')
    s.up('ArrowRight')
    s.up('ArrowLeft')
    s.take()
    expect(s.step(DAS_MS + ARR_MS * 5)).toEqual([])
  })
})

describe('preventDefault', () => {
  it('矢印と Space はページをスクロールさせない', () => {
    const s = setup()
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']) {
      expect(s.down(key).prevented).toBe(true)
    }
  })

  it('OS のリピートで飛んできた分も止める', () => {
    const s = setup()
    s.down('ArrowLeft')
    expect(s.down('ArrowLeft', true).prevented).toBe(true)
  })

  it('ゲームに関係ないキーは止めない', () => {
    const s = setup()
    expect(s.down('a').prevented).toBe(false)
    expect(s.down('c').prevented).toBe(false)
  })
})

describe('フォーカスと後始末', () => {
  it('blur で押下状態がリセットされる', () => {
    const s = setup()
    s.down('ArrowLeft')
    s.take()
    s.blur()
    expect(s.step(DAS_MS + ARR_MS * 5)).toEqual([])
  })

  it('blur 中に離された ↓ のために softDropEnd を出す', () => {
    const s = setup()
    s.down('ArrowDown')
    s.take()
    s.blur()
    expect(s.take()).toEqual(['softDropEnd'])
  })

  it('blur 後も押し直せば効く', () => {
    const s = setup()
    s.down('ArrowLeft')
    s.take()
    s.blur()
    s.down('ArrowLeft')
    expect(s.take()).toEqual(['moveLeft'])
  })

  it('dispose でリスナがすべて外れる', () => {
    const s = setup()
    expect(s.listenerCount()).toBeGreaterThan(0)
    s.input.dispose()
    expect(s.listenerCount()).toBe(0)
    s.down('ArrowLeft')
    expect(s.take()).toEqual([])
  })
})
