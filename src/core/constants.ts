/**
 * 調整対象の数値はすべてこのファイルに集約する。
 *
 * 操作感（キー長押しの効き、着地後の猶予、落下速度）は言葉では決まらず、
 * 実際に触って直すことになる。そのとき探し回らずに済むよう1箇所にまとめている。
 */
import type { PieceKind } from './types'

// ── 盤面 ────────────────────────────────────────────────
export const BOARD_WIDTH = 10
/** 画面に見える行数。 */
export const VISIBLE_ROWS = 20
/** 出現直後のピースを置くための、画面外の上部バッファ行数。 */
export const BUFFER_ROWS = 2
/** 内部の盤面高さ。`cells[y]` の y はこの範囲。 */
export const BOARD_HEIGHT = VISIBLE_ROWS + BUFFER_ROWS
/** 出現時のピース外接ボックスの左上 y 座標。 */
export const SPAWN_ORIGIN_Y = 1

// ── スコアとレベル ──────────────────────────────────────
/** 添字 = 同時に消した行数。レベル倍率を掛けて加算する。 */
export const LINE_CLEAR_BASE = [0, 100, 300, 500, 800] as const
export const SOFT_DROP_POINTS_PER_CELL = 1
export const HARD_DROP_POINTS_PER_CELL = 2
export const LINES_PER_LEVEL = 10
export const MAX_LEVEL = 15

/**
 * レベル別の自然落下間隔（ミリ秒）。添字 = level - 1。
 * MAX_LEVEL を超えたら最後の値で頭打ちにする。
 */
export const DROP_INTERVAL_MS = [
  1000, 793, 618, 473, 355, 262, 190, 135, 94, 64, 43, 28, 18, 11, 7,
] as const

// ── 挙動のタイミング ────────────────────────────────────
/** 着地してからロックされるまでの猶予。無いと微調整ができず窮屈に感じる。 */
export const LOCK_DELAY_MS = 500
/** 猶予のリセット回数上限。無制限だと回し続けて永久に落ちない。 */
export const LOCK_RESET_LIMIT = 15
/** 横キー長押しで連続移動が始まるまでの待ち時間。 */
export const DAS_MS = 167
/** 連続移動中の1セルあたりの間隔。 */
export const ARR_MS = 33
/** ソフトドロップ中の1セルあたりの間隔。 */
export const SOFT_DROP_INTERVAL_MS = 33
/** タブ非アクティブ復帰時の巨大な dt を切り捨てる上限。 */
export const MAX_FRAME_DELTA_MS = 100

// ── 見た目 ──────────────────────────────────────────────
/** 素材を持たないため単色。輪郭線と明度差で立体感を出す。 */
export const PIECE_COLORS: Readonly<Record<PieceKind, string>> = {
  I: '#22d3ee',
  J: '#3b82f6',
  L: '#f97316',
  O: '#facc15',
  S: '#22c55e',
  T: '#a855f7',
  Z: '#ef4444',
}
export const BOARD_BG = '#0f1117'
export const GRID_LINE = '#1e2230'
export const GHOST_ALPHA = 0.22
/** 基準セルサイズ。実際は画面サイズに合わせて縮尺する。 */
export const CELL_SIZE_PX = 30

// ── 永続化 ──────────────────────────────────────────────
export const STORAGE_KEY = 'blockdrop.highscore'

// ── タッチ操作の閾値 ────────────────────────────────────
/** 横ドラッグでこの距離動くごとに1セル移動する。 */
export const TOUCH_MOVE_CELL_PX = 24
/** これ以下の移動量かつ時間ならタップ（＝回転）とみなす。 */
export const TOUCH_TAP_MAX_PX = 12
export const TOUCH_TAP_MAX_MS = 220
/** 下方向にこの距離を、この時間以内に動かしたらハードドロップ。 */
export const TOUCH_FLICK_MIN_PX = 60
export const TOUCH_FLICK_MAX_MS = 250
/** 下方向へゆっくり動かすとき、この距離ごとにソフトドロップを1セル分進める。 */
export const TOUCH_SOFT_DROP_CELL_PX = 24

// ── DOM 要素の id ───────────────────────────────────────
/** 入力層と描画層が同じ要素を指せるように、id は文字列リテラルで散らさない。 */
export const DOM_IDS = {
  board: 'board',
  next: 'next',
  hold: 'hold',
  score: 'score',
  best: 'best',
  lines: 'lines',
  level: 'level',
  btnHold: 'btn-hold',
  btnPause: 'btn-pause',
  btnRestart: 'btn-restart',
  overlay: 'overlay',
  overlayTitle: 'overlay-title',
  overlayHint: 'overlay-hint',
} as const
