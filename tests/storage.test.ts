/**
 * storage のテスト。
 *
 * このモジュールの要件は「値を覚えること」より先に「例外を投げないこと」にある。
 * localStorage はプライベートモードやブラウザ設定で、参照した瞬間から投げてくる。
 * そこで落ちると開いても遊べないため、壊れ方ごとに固定しておく。
 *
 * Vitest の環境は node なので localStorage は存在しない。各テストで
 * `globalThis.localStorage` を差し替え、後始末で必ず元に戻す。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEY } from '../src/core/constants'
import { createHighScoreStore } from '../src/platform/storage'

/** getItem / setItem だけあれば実装は動く。Storage 全体を作る必要はない。 */
type FakeStorage = Pick<Storage, 'getItem' | 'setItem'>

function install(fake: FakeStorage): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: fake as Storage,
  })
}

/** localStorage が存在しない状態に戻す。node 環境の既定はこれ。 */
function uninstall(): void {
  Reflect.deleteProperty(globalThis, 'localStorage')
}

/** 中身を持つ、普通に動く保存先。 */
function workingStorage(initial?: string): FakeStorage & { readonly written: Map<string, string> } {
  const written = new Map<string, string>()
  if (initial !== undefined) written.set(STORAGE_KEY, initial)
  return {
    written,
    getItem: (key) => written.get(key) ?? null,
    setItem: (key, value) => {
      written.set(key, value)
    },
  }
}

beforeEach(uninstall)
afterEach(uninstall)

describe('createHighScoreStore', () => {
  describe('正常に読み書きできる環境', () => {
    it('保存した値をそのキーで読み戻せる', () => {
      const fake = workingStorage()
      install(fake)

      const store = createHighScoreStore()
      store.save(12_345)

      expect(fake.written.get(STORAGE_KEY)).toBe('12345')
      expect(createHighScoreStore().load()).toBe(12_345)
    })

    it('何も保存されていなければ 0', () => {
      install(workingStorage())
      expect(createHighScoreStore().load()).toBe(0)
    })
  })

  describe('localStorage が存在しない環境', () => {
    it('load は 0 を返し、save は投げない', () => {
      const store = createHighScoreStore()
      expect(store.load()).toBe(0)
      expect(() => store.save(500)).not.toThrow()
    })

    it('その局の間はメモリ上の値で読み書きが成立する', () => {
      const store = createHighScoreStore()
      store.save(800)
      // 次に開いたときには消えているが、遊んでいる間の自己ベスト表示は保てる。
      expect(store.load()).toBe(800)
    })
  })

  describe('localStorage に触れると例外を投げる環境', () => {
    it('参照そのものが投げても load / save は投げない', () => {
      // プライベートモードやサードパーティ Cookie 禁止では、getter が SecurityError を投げる。
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get(): Storage {
          throw new Error('SecurityError: localStorage へのアクセスが拒否された')
        },
      })

      const store = createHighScoreStore()
      expect(() => store.save(1_000)).not.toThrow()
      expect(() => store.load()).not.toThrow()
      expect(store.load()).toBe(1_000)
    })

    it('getItem / setItem が投げても load / save は投げない', () => {
      install({
        getItem: () => {
          throw new Error('読み出し不可')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      })

      const store = createHighScoreStore()
      expect(() => store.save(1_000)).not.toThrow()
      expect(store.load()).toBe(1_000)
    })
  })

  describe('壊れた値が保存されている場合', () => {
    // 他のスクリプトや手動編集で入りうるもの。いずれも自己ベストとしては成立しない。
    const broken = ['abc', '', '   ', '-5', 'NaN', 'Infinity', '1e999', '12.5', '1e30', '{}']

    for (const raw of broken) {
      it(`${JSON.stringify(raw)} は 0 として扱う`, () => {
        install(workingStorage(raw))
        expect(createHighScoreStore().load()).toBe(0)
      })
    }

    it('壊れた値を渡された save は、保存済みの正しい値を潰さない', () => {
      const fake = workingStorage('900')
      install(fake)

      const store = createHighScoreStore()
      store.save(Number.NaN)
      store.save(-1)

      expect(fake.written.get(STORAGE_KEY)).toBe('900')
      expect(store.load()).toBe(900)
    })
  })
})
