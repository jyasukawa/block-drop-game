/**
 * 共有の型定義。すべてのモジュールがこのファイルの型に従う。
 *
 * 座標系は一貫して「左上原点・x は右が正・y は下が正」。
 * 参考資料の多くは y 上向きで書かれているため、移植するときは必ず y を反転させること。
 */

/** 7種のピース。 */
export type PieceKind = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z'

/**
 * 回転状態。0 = 出現時、1 = 右回転1回、2 = 180度、3 = 左回転1回。
 * SRS のキックテーブルはこの番号の遷移（例: 0->1）で引く。
 */
export type RotationState = 0 | 1 | 2 | 3

/** 盤面の1マス。null は空。 */
export type Cell = PieceKind | null

/** 盤面座標、またはオフセット。 */
export interface Vec {
  readonly x: number
  readonly y: number
}

/**
 * 盤面。`cells[y][x]` でアクセスする。
 * height はバッファ行を含む内部高さ（= VISIBLE_ROWS + BUFFER_ROWS）。
 * y < BUFFER_ROWS の行は画面に描かない。
 */
export interface Board {
  readonly width: number
  readonly height: number
  readonly cells: readonly (readonly Cell[])[]
}

/**
 * 落下中のピース。
 * `pos` はピースの外接ボックス（I と O は 4x4、それ以外は 3x3）の左上角の盤面座標。
 * 実際に占めるセルは `cellsOf(kind, rotation)` の各要素に `pos` を加えたもの。
 */
export interface ActivePiece {
  readonly kind: PieceKind
  readonly rotation: RotationState
  readonly pos: Vec
}

/** ライン消去の結果。`board` は消去後の盤面。 */
export interface LineClearResult {
  readonly board: Board
  readonly cleared: number
}

/** ゲームの進行状態。要件どおり URL を開いた瞬間から遊べるので、開始待ちの状態は持たない。 */
export type Phase = 'playing' | 'paused' | 'gameover'

/** 描画と保存が読む唯一のスナップショット。core の外からは読み取り専用として扱う。 */
export interface GameState {
  readonly board: Board
  /** ゲームオーバー時は null。 */
  readonly active: ActivePiece | null
  readonly next: PieceKind
  readonly hold: PieceKind | null
  /** ホールドは1回の落下につき1度まで。使ったら次の設置まで false。 */
  readonly canHold: boolean
  readonly score: number
  readonly lines: number
  /** 1 から始まる。 */
  readonly level: number
  readonly phase: Phase
  readonly highScore: number
  /**
   * この局のピース順を決めているシード。
   *
   * 乱数を注入式にしたのは不具合を再現できるようにするためだが、実プレイのシードが
   * どこにも残らないとその仕組みは働かない。ここに出しておけば、報告されたシードから
   * 同じ局を再現できる。
   */
  readonly seed: number
}

/** 入力層が生成し、core が解釈する操作。入力デバイスの違いはここで吸収される。 */
export type Action =
  | { readonly type: 'moveLeft' }
  | { readonly type: 'moveRight' }
  | { readonly type: 'rotateCW' }
  | { readonly type: 'rotateCCW' }
  | { readonly type: 'softDropStart' }
  | { readonly type: 'softDropEnd' }
  | { readonly type: 'hardDrop' }
  | { readonly type: 'hold' }
  | { readonly type: 'togglePause' }
  | { readonly type: 'restart' }

/**
 * 乱数源。0 以上 1 未満を返す。
 * core が `Math.random` を直接呼ばないのは、シードを固定してピース順を再現できるようにするため。
 */
export type Rng = () => number

/** ピースの供給元。7-bag の実装がこれを満たす。 */
export interface Randomizer {
  next(): PieceKind
}
