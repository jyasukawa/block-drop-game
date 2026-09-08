/**
 * 自己ベストの保存。
 *
 * ── Phase 4-C の担当ファイル。シグネチャは契約なので変更しないこと。
 */
import { STORAGE_KEY } from '../core/constants'

export interface HighScoreStore {
  /** 保存された自己ベスト。読めなければ 0。 */
  load(): number
  /** 自己ベストを保存する。失敗しても例外を投げない。 */
  save(score: number): void
}

/**
 * 自己ベストとして成立する値だけを通す。成立しなければ null。
 *
 * 保存先は他のスクリプトからも手からも書き換えられるので、入っている文字列が
 * 数値である保証はない。負・NaN・非整数・安全整数を超える巨大な値も自己ベストとしては
 * ありえないため、まとめて「読めなかった」ものとして扱う。
 */
function sanitize(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) return null
  if (!Number.isInteger(value)) return null
  if (value < 0 || value > Number.MAX_SAFE_INTEGER) return null
  return value
}

export function createHighScoreStore(): HighScoreStore {
  /**
   * localStorage が使えないときの退避先。
   *
   * プライベートモードやブラウザ設定では localStorage に「触れること自体」が例外を投げる。
   * ここでクラッシュすると開いても遊べないので、その局の間だけ覚えるメモリ値に落とす。
   * 遊べさえすれば、次に開いたとき自己ベストが消えているのは受け入れられる。
   */
  let memory = 0

  /**
   * 使える localStorage、無ければ null。
   *
   * `typeof` の確認と try/catch の両方が要る。「そもそも存在しない」（Node のテスト環境が
   * まさにこれ）と「参照した瞬間に投げる」は別物で、片方だけでは防げないため。
   */
  function storage(): Storage | null {
    try {
      if (typeof localStorage === 'undefined') return null
      return localStorage
    } catch {
      return null
    }
  }

  return {
    load(): number {
      try {
        const raw = storage()?.getItem(STORAGE_KEY)
        if (raw === null || raw === undefined) return memory
        const value = sanitize(raw)
        if (value === null) return memory
        memory = value
        return value
      } catch {
        return memory
      }
    },

    save(score: number): void {
      const value = sanitize(score)
      // 壊れた値をそのまま書くと、保存済みの正しい自己ベストを潰してしまう。黙って捨てる。
      if (value === null) return
      // 先にメモリへ入れておく。書き込みが失敗しても、この局の間は正しい値を返せる。
      memory = value
      try {
        storage()?.setItem(STORAGE_KEY, String(value))
      } catch {
        // 容量超過や書き込み禁止。保存できないだけで、遊べなくなる理由にはならない。
      }
    },
  }
}
