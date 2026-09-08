/**
 * 入力デバイスの共通インターフェース。
 *
 * キーボードとタッチは「生のイベントをどう解釈するか」がまったく違うが、
 * 出てくるものは同じ `Action` である。ここで形を揃えておけば、`main.ts` は
 * デバイスの数だけループを回すだけで済み、新しい入力手段を足しても配線が変わらない。
 *
 * ── オーケストレータが用意する契約ファイル。実装タスクは変更しないこと。
 */
import type { Action } from '../core/types'

export interface InputSource {
  /**
   * 経過時間を伝える。キーリピート（長押しの連続移動）のように、
   * 時間に依存する入力の判定に使う。時間を持たない入力源は無視してよい。
   */
  tick(deltaMs: number): void
  /** 溜まった操作を取り出す。取り出した分はキューから消える。 */
  drain(): Action[]
  /** イベントリスナを外す。 */
  dispose(): void
}

export interface ActionQueue {
  push(action: Action): void
  drain(): Action[]
}

/**
 * 溜めて一括で取り出すだけのキュー。
 *
 * 入力イベントはブラウザの都合で任意のタイミングに飛んでくるが、ゲームの更新は
 * フレーム単位で進む。その間を埋めるためのもので、どの入力源にも同じものが要る。
 * 各実装が自前で書くと同じコードが増えるので、ここに1つ置いてある。
 */
export function createActionQueue(): ActionQueue {
  let pending: Action[] = []
  return {
    push(action) {
      pending.push(action)
    },
    drain() {
      if (pending.length === 0) return []
      const taken = pending
      pending = []
      return taken
    },
  }
}
