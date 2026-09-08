/**
 * GameState を画面に描く。DOM のテキスト表示もここが受け持つ。
 *
 * ── Phase 4-A の担当ファイル。シグネチャは契約なので変更しないこと。
 */
import type { ActivePiece, Board, GameState, PieceKind } from '../core/types'
import {
  BOARD_BG,
  BOARD_WIDTH,
  BUFFER_ROWS,
  CELL_SIZE_PX,
  DOM_IDS,
  GHOST_ALPHA,
  GRID_LINE,
  PIECE_COLORS,
  VISIBLE_ROWS,
} from '../core/constants'
import { ghostOf } from '../core/board'
import { PIECE_KINDS, absoluteCells, boxSizeOf, cellsOf } from '../core/pieces'

export interface Renderer {
  /** 現在の状態を描く。毎フレーム呼ばれる。 */
  draw(state: GameState): void
  /** 画面サイズが変わったときに呼ぶ。canvas の実解像度を取り直す。 */
  resize(): void
}

/**
 * セルサイズの下限。これを割ると指でも目でも1マスを追えないので、
 * ここまで来たら画面に収めることより見えることを優先する（＝はみ出しを許す）。
 */
const MIN_CELL_PX = 10
/**
 * セルサイズの上限。大画面で青天井に拡大しても、盤面の端から端への視線移動が増えるだけで
 * 遊びやすくはならない。基準セルの 1.5 倍で止める。
 */
const MAX_CELL_PX = Math.round(CELL_SIZE_PX * 1.5)
/** プレビュー枠の余白（セル数、上下左右の合計）。ピースが枠に接すると窮屈に見える。 */
const PREVIEW_MARGIN_CELLS = 1
/**
 * プレビューのセルサイズを画面短辺の何分の1にするか。
 * 盤面のセルサイズから決めると「盤面 → パネル寸法 → 盤面」と循環するので、画面から直接決める。
 */
const PREVIEW_CELL_DIVISOR = 26
const PREVIEW_MIN_CELL_PX = 8
const PREVIEW_MAX_CELL_PX = 20

/**
 * プレビュー枠の論理グリッド。ピースごとに寸法を変えると canvas の縦横比が変わり、
 * NEXT が切り替わるたびにパネルの高さが動いてしまう。全種が収まる最大寸法に固定する。
 */
const PREVIEW_GRID = ((): { readonly cols: number; readonly rows: number } => {
  let cols = 0
  let rows = 0
  for (const kind of PIECE_KINDS) {
    // 横は外接ボックスの幅に合わせる（I の 4 が最大）。縦は実際に埋まる行だけあれば足りる。
    cols = Math.max(cols, boxSizeOf(kind))
    rows = Math.max(rows, extentOf(kind).h)
  }
  return { cols, rows }
})()

/** DOM から必要な要素を集めて描画器を作る。要素が見つからなければ例外を投げてよい。 */
export function createRenderer(): Renderer {
  const boardCanvas = requireCanvas(DOM_IDS.board)
  const nextCanvas = requireCanvas(DOM_IDS.next)
  const holdCanvas = requireCanvas(DOM_IDS.hold)
  const boardCtx = require2d(boardCanvas)
  const nextCtx = require2d(nextCanvas)
  const holdCtx = require2d(holdCanvas)

  const scoreEl = requireElement(DOM_IDS.score)
  const bestEl = requireElement(DOM_IDS.best)
  const linesEl = requireElement(DOM_IDS.lines)
  const levelEl = requireElement(DOM_IDS.level)
  const overlayEl = requireElement(DOM_IDS.overlay)
  const overlayTitleEl = requireElement(DOM_IDS.overlayTitle)
  const overlayHintEl = requireElement(DOM_IDS.overlayHint)

  // 縮尺の計算には盤面の外側（パネル・操作説明・余白）の実寸が要る。
  // これらに id を増やさずに済むよう、既知の要素からの親子関係で辿る。
  const stage = boardCanvas.parentElement
  const app = stage?.parentElement ?? null
  const panel = nextCanvas.parentElement?.parentElement ?? null

  // 描画はすべて CSS px の論理座標で行い、実解像度との差は変換行列が吸収する。
  let cell = CELL_SIZE_PX
  let previewCell = PREVIEW_MAX_CELL_PX
  let previewW = 0
  let previewH = 0

  // 毎フレーム textContent に代入すると、値が同じでもレイアウトが走る。直前の値と比べて書く。
  const lastText = new Map<HTMLElement, string>()
  // プレビューは中身が変わらない限り描き直す必要がない。canvas も DOM 越しの操作なので削る。
  let lastNext: PieceKind | null = null
  let lastHold: PieceKind | null = null
  let lastCanHold = true
  let previewsStale = true

  function setText(el: HTMLElement, value: string): void {
    if (lastText.get(el) === value) return
    el.textContent = value
    lastText.set(el, value)
  }

  /** canvas の CSS 上の寸法と実解像度を合わせ、以後 CSS px で描けるようにする。 */
  function sizeCanvas(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
  ): void {
    const dpr = window.devicePixelRatio || 1
    const extra = borderBoxExtra(canvas)
    // box-sizing: border-box なので、枠線ぶんを足さないと描画面が縮んで縮尺がずれる。
    canvas.style.width = `${cssW + extra.x}px`
    canvas.style.height = `${cssH + extra.y}px`

    const pixelW = Math.max(1, Math.round(cssW * dpr))
    const pixelH = Math.max(1, Math.round(cssH * dpr))
    // 同じ値の代入でも canvas は内容を破棄して確保し直すため、変わったときだけ書く。
    if (canvas.width !== pixelW) canvas.width = pixelW
    if (canvas.height !== pixelH) canvas.height = pixelH
    ctx.setTransform(pixelW / cssW, 0, 0, pixelH / cssH, 0, 0)
  }

  function layoutPreviews(): void {
    const vmin = Math.min(viewportWidth(), viewportHeight())
    previewCell = clamp(
      Math.floor(vmin / PREVIEW_CELL_DIVISOR),
      PREVIEW_MIN_CELL_PX,
      PREVIEW_MAX_CELL_PX,
    )
    previewW = (PREVIEW_GRID.cols + PREVIEW_MARGIN_CELLS) * previewCell
    previewH = (PREVIEW_GRID.rows + PREVIEW_MARGIN_CELLS) * previewCell
    // 寸法未設定の canvas は既定の 300x150 のまま間延びする。CSS 側は width:100% なので、
    // インラインで実寸を指定して縦横比を確定させる。
    sizeCanvas(nextCanvas, nextCtx, previewW, previewH)
    sizeCanvas(holdCanvas, holdCtx, previewW, previewH)
  }

  /**
   * 盤面を「いま空いている領域」に収める。CELL_SIZE_PX を固定で使うと、
   * 高さ 570px 程度のビューポートで 20 行が画面からはみ出す。
   */
  function layoutBoard(): void {
    let availableW = viewportWidth()
    let availableH = viewportHeight()

    if (app !== null) {
      const style = getComputedStyle(app)
      // safe-area-inset を含むため、余白は定数ではなく実測値を使う。
      availableW -= px(style.paddingLeft) + px(style.paddingRight)
      availableH -= px(style.paddingTop) + px(style.paddingBottom)
      const gap = px(style.rowGap)
      // 盤面の兄弟（操作説明など）が使う高さを引く。要素を名指しすると HTML の変更に
      // 追随できないので「#stage 以外の子」として測る。position:fixed のオーバーレイは
      // レイアウトを占めず offsetParent が null になるので、この判定で除外できる。
      for (const child of Array.from(app.children)) {
        if (child === stage || !(child instanceof HTMLElement)) continue
        if (child.offsetParent === null) continue
        availableH -= child.offsetHeight + gap
      }
    }

    if (stage !== null && panel !== null) {
      const style = getComputedStyle(stage)
      // 横並びか縦積みかは CSS のメディアクエリが決める。閾値をこちらにも書くと
      // 二重管理になるので、結果として適用された flex-direction を読む。
      if (style.flexDirection === 'column') {
        availableH -= panel.offsetHeight + px(style.rowGap)
      } else {
        availableW -= panel.offsetWidth + px(style.columnGap)
      }
    }

    // 幅と高さのどちらか厳しいほうに合わせる。これで縦長でも横長でも 20 行全部が見える。
    const byWidth = availableW / BOARD_WIDTH
    const byHeight = availableH / VISIBLE_ROWS
    // 整数に丸めるのは、グリッド線とセル境界を実解像度の整数位置に乗せてぼやけを防ぐため。
    cell = clamp(Math.floor(Math.min(byWidth, byHeight)), MIN_CELL_PX, MAX_CELL_PX)
    sizeCanvas(boardCanvas, boardCtx, cell * BOARD_WIDTH, cell * VISIBLE_ROWS)
  }

  function drawBoard(state: GameState): void {
    const ctx = boardCtx
    const width = cell * BOARD_WIDTH
    const height = cell * VISIBLE_ROWS

    ctx.fillStyle = BOARD_BG
    ctx.fillRect(0, 0, width, height)
    drawGrid(ctx, width, height, cell)

    drawLockedCells(ctx, state.board, cell)

    if (state.active !== null) {
      // ゴーストを先に描いて実体で上書きする。着地寸前で両者が重なっても実体が勝つ。
      drawPiece(ctx, ghostOf(state.board, state.active), cell, true)
      drawPiece(ctx, state.active, cell, false)
    }
  }

  /** NEXT / HOLD の1枠。`dimmed` はホールド使用済みの表現。 */
  function drawPreview(
    ctx: CanvasRenderingContext2D,
    kind: PieceKind | null,
    dimmed: boolean,
  ): void {
    // 塗りつぶさずに消すのは、枠の背景色を CSS 側に任せているため。
    ctx.clearRect(0, 0, previewW, previewH)
    if (kind === null) return

    // 暗い枠の上に薄く重ねると沈んで見える。これが「使用済み」の合図になる。
    ctx.globalAlpha = dimmed ? 0.3 : 1
    const cells = cellsOf(kind, 0)
    const extent = extentOf(kind)
    // 外接ボックスではなく実際に埋まっているセルの範囲で中央に置く。
    // 箱の空き列を含めると、I や J が枠の中で片寄って見える。
    const originX = (previewW - extent.w * previewCell) / 2 - extent.minX * previewCell
    const originY = (previewH - extent.h * previewCell) / 2 - extent.minY * previewCell
    for (const c of cells) {
      drawBlock(
        ctx,
        originX + c.x * previewCell,
        originY + c.y * previewCell,
        previewCell,
        PIECE_COLORS[kind],
      )
    }
    ctx.globalAlpha = 1
  }

  function drawOverlay(state: GameState): void {
    if (state.phase === 'playing') {
      // 表示/非表示は hidden 属性で切り替える。style を直接触ると CSS 側の display 指定を壊す。
      if (!overlayEl.hidden) overlayEl.hidden = true
      return
    }
    if (state.phase === 'paused') {
      setText(overlayTitleEl, 'PAUSED')
      setText(overlayHintEl, 'P キー / PAUSE ボタンで再開')
    } else {
      setText(overlayTitleEl, 'GAME OVER')
      setText(overlayHintEl, `SCORE ${state.score}　BEST ${state.highScore}　／　R キー / RESTART でもう一度`)
    }
    if (overlayEl.hidden) overlayEl.hidden = false
  }

  function draw(state: GameState): void {
    drawBoard(state)

    if (previewsStale || state.next !== lastNext) {
      drawPreview(nextCtx, state.next, false)
      lastNext = state.next
    }
    if (previewsStale || state.hold !== lastHold || state.canHold !== lastCanHold) {
      drawPreview(holdCtx, state.hold, !state.canHold)
      lastHold = state.hold
      lastCanHold = state.canHold
    }
    previewsStale = false

    setText(scoreEl, String(state.score))
    setText(bestEl, String(state.highScore))
    setText(linesEl, String(state.lines))
    setText(levelEl, String(state.level))

    drawOverlay(state)
  }

  function resize(): void {
    layoutPreviews()
    // 2回測るのは、縦積みレイアウトでは #panel の折り返し行数が盤面の幅で決まるため。
    // 1回目の結果を DOM に反映してから測り直さないと、パネルが2行になった分だけはみ出す。
    layoutBoard()
    layoutBoard()
    // canvas の寸法変更で中身は消えている。盤面は毎フレーム描き直すが、プレビューは描き直さない。
    previewsStale = true
  }

  resize()
  return { draw, resize }
}

// ── 描画の部品 ──────────────────────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  size: number,
): void {
  // 線を stroke ではなく 1px の矩形で描くのは、実解像度が整数倍のとき境界がぼけないため。
  ctx.fillStyle = GRID_LINE
  for (let x = 1; x < BOARD_WIDTH; x += 1) ctx.fillRect(x * size, 0, 1, height)
  for (let y = 1; y < VISIBLE_ROWS; y += 1) ctx.fillRect(0, y * size, width, 1)
}

function drawLockedCells(ctx: CanvasRenderingContext2D, board: Board, size: number): void {
  for (let y = BUFFER_ROWS; y < board.height; y += 1) {
    const row = board.cells[y]
    if (row === undefined) continue
    for (let x = 0; x < board.width; x += 1) {
      const kind = row[x]
      if (kind == null) continue
      drawBlock(ctx, x * size, (y - BUFFER_ROWS) * size, size, PIECE_COLORS[kind])
    }
  }
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: ActivePiece,
  size: number,
  ghost: boolean,
): void {
  const color = PIECE_COLORS[piece.kind]
  for (const { x, y } of absoluteCells(piece)) {
    // バッファ行は画面外。出現直後のピースは上半分が隠れる。
    if (y < BUFFER_ROWS) continue
    const px = x * size
    const py = (y - BUFFER_ROWS) * size
    if (ghost) drawGhostBlock(ctx, px, py, size, color)
    else drawBlock(ctx, px, py, size, color)
  }
}

/**
 * 1マス分のブロック。素材を持たないので、単色 + ベベル + 輪郭線で立体感を出す。
 * 明暗の差は色相に頼らない手掛かりでもあり、色の見分けにくさへの備えを兼ねる。
 */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const bevel = Math.max(1, Math.round(size * 0.16))

  ctx.fillStyle = color
  ctx.fillRect(x, y, size, size)

  // 左上が明るい面。
  ctx.fillStyle = 'rgba(255, 255, 255, 0.38)'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + size, y)
  ctx.lineTo(x + size - bevel, y + bevel)
  ctx.lineTo(x + bevel, y + bevel)
  ctx.lineTo(x + bevel, y + size - bevel)
  ctx.lineTo(x, y + size)
  ctx.closePath()
  ctx.fill()

  // 右下が暗い面。
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
  ctx.beginPath()
  ctx.moveTo(x + size, y)
  ctx.lineTo(x + size, y + size)
  ctx.lineTo(x, y + size)
  ctx.lineTo(x + bevel, y + size - bevel)
  ctx.lineTo(x + size - bevel, y + size - bevel)
  ctx.lineTo(x + size - bevel, y + bevel)
  ctx.closePath()
  ctx.fill()

  // 同色のブロックが隣り合っても境目が分かるよう、輪郭線は必ず引く。
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)
}

/** ゴーストは塗りだけだと背景に沈む。落下先が読めないと置けないので輪郭は濃く残す。 */
function drawGhostBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const previous = ctx.globalAlpha
  ctx.globalAlpha = previous * GHOST_ALPHA
  ctx.fillStyle = color
  ctx.fillRect(x, y, size, size)

  ctx.globalAlpha = previous * Math.min(1, GHOST_ALPHA * 3)
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, Math.round(size * 0.08))
  const inset = ctx.lineWidth / 2
  ctx.strokeRect(x + inset, y + inset, size - ctx.lineWidth, size - ctx.lineWidth)
  ctx.globalAlpha = previous
}

// ── 小物 ────────────────────────────────────────────────

/** 出現時の形が実際に占める範囲。プレビューの中央寄せに使う。 */
function extentOf(kind: PieceKind): {
  readonly minX: number
  readonly minY: number
  readonly w: number
  readonly h: number
} {
  const cells = cellsOf(kind, 0)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const c of cells) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x)
    maxY = Math.max(maxY, c.y)
  }
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLElement)) throw new Error(`#${id} が見つからない`)
  return el
}

function requireCanvas(id: string): HTMLCanvasElement {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLCanvasElement)) throw new Error(`#${id} が見つからない、または canvas ではない`)
  return el
}

function require2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error(`#${canvas.id} の 2D コンテキストを取得できない`)
  return ctx
}

/** border-box のとき、指定した幅に上乗せしないと描画面が枠線ぶん縮む。 */
function borderBoxExtra(el: HTMLElement): { readonly x: number; readonly y: number } {
  const style = getComputedStyle(el)
  if (style.boxSizing !== 'border-box') return { x: 0, y: 0 }
  return {
    x: px(style.borderLeftWidth) + px(style.borderRightWidth) + px(style.paddingLeft) + px(style.paddingRight),
    y: px(style.borderTopWidth) + px(style.borderBottomWidth) + px(style.paddingTop) + px(style.paddingBottom),
  }
}

/** getComputedStyle は 'normal' など数値でない値も返す。取れなければ 0 とみなす。 */
function px(value: string): number {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/** アドレスバーの伸縮を含む実際の表示領域。iOS では innerHeight とずれる。 */
function viewportWidth(): number {
  return window.visualViewport?.width ?? window.innerWidth
}

function viewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
