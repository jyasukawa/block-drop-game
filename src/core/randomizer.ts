/**
 * ピースの出現順。
 *
 * 純粋な乱数だと同じピースが偏って出て理不尽に感じるので、7種を1巡ずつシャッフルして配る
 * （7-bag）。乱数を注入式にしているのは、シードを固定して出現順を完全に再現できるようにするため。
 * 「あの場面で回転できなかった」を後から再現して調べられる。
 *
 * ── Phase 2-C の担当ファイル。シグネチャは契約なので変更しないこと。
 */
import type { PieceKind, Randomizer, Rng } from './types'
import { PIECE_KINDS } from './pieces'

/** 同じシードなら必ず同じ列を返す乱数。テストと不具合再現に使う。 */
export function createSeededRng(seed: number): Rng {
  // mulberry32。状態が 32bit ひとつで済むので実行時依存を足さずに書け、
  // ピース順を決める用途には十分な質の列が得られる。暗号用途ではないので強度は求めない。
  // シードを符号なし32bitに丸めるのは、負の数や小数を渡されても状態が壊れないようにするため。
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    // 2^32 で割るので、結果は必ず 0 以上 1 未満に収まる（Rng の契約）。
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fisher-Yates で並びを作る。
 *
 * 末尾から順に「まだ選んでいない範囲から1つ」を選んで交換するので、7! 通りの並びが等確率になる。
 * 手軽な `sort(() => rng() - 0.5)` は比較関数が一貫しないぶん並びに偏りが出るため使わない。
 */
function shuffled(kinds: readonly PieceKind[], rng: Rng): PieceKind[] {
  const out = kinds.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    // Rng が 1 未満を返す限り j は 0..i に収まる。
    const j = Math.floor(rng() * (i + 1))
    const a = out[i]
    const b = out[j]
    // 契約を破る Rng（1 以上や NaN を返すもの）を静かに握り潰すと、
    // 出現順の偏りとして後から発覚することになるのでここで落とす。
    if (a === undefined || b === undefined) {
      throw new Error(`シャッフルの添字が範囲外: ${i} <-> ${j}`)
    }
    out[i] = b
    out[j] = a
  }
  return out
}

/** 7種を1巡ずつシャッフルして配るピース供給元。 */
export function createBagRandomizer(rng: Rng): Randomizer {
  // 空になった時点で次の袋を作る。先に7個ぶん配り切ってから補充するので、
  // どの連続する7個を取っても7種がちょうど1回ずつ現れる。
  let bag: PieceKind[] = []
  return {
    next(): PieceKind {
      if (bag.length === 0) bag = shuffled(PIECE_KINDS, rng)
      // 末尾から取るのは配列の詰め直しを避けるため。並びはシャッフル済みなので偏りには影響しない。
      const kind = bag.pop()
      if (kind === undefined) throw new Error('袋が空のまま補充されなかった')
      return kind
    },
  }
}
