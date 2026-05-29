import Phaser from 'phaser'

export const TILE = 40
export const CANVAS_WIDTH = 800
export const CANVAS_HEIGHT = 600

/** Palette — 新中式数字美学 */
const C = {
  grassBase: 0x8fa989,
  grassSpeck: 0x6b7f67,
  grassSpeckAlt: 0x7a8e76,
  waterBase: 0x2c4a5e,
  waterHighlight: 0x3d6278,
  waterDeep: 0x1e3340,
  ink: 0x1a1a1a,
  paper: 0xf5f0e6,
} as const

/** Deterministic hash — stable rice-paper speckle per tile. */
function hash2D(col: number, row: number, salt = 0): number {
  let h = col * 374761393 + row * 668265263 + salt * 982451653
  h = (h ^ (h >>> 13)) * 1274126177
  return (h ^ (h >>> 16)) >>> 0
}

function speckleCount(col: number, row: number): number {
  return 4 + (hash2D(col, row, 7) % 3)
}

function isWaterTile(col: number, row: number, cols: number, rows: number): boolean {
  return col < 2 || col >= cols - 2 || row >= rows - 3
}

function isWaterEdge(col: number, row: number, cols: number, rows: number): boolean {
  if (!isWaterTile(col, row, cols, rows)) return false
  const landNeighbors = [
    [col - 1, row],
    [col + 1, row],
    [col, row - 1],
    [col, row + 1],
  ]
  return landNeighbors.some(
    ([c, r]) => c >= 0 && c < cols && r >= 0 && r < rows && !isWaterTile(c, r, cols, rows),
  )
}

function drawGrassTile(g: Phaser.GameObjects.Graphics, x: number, y: number, col: number, row: number): void {
  g.fillStyle(C.grassBase, 1)
  g.fillRect(x, y, TILE, TILE)

  const count = speckleCount(col, row)
  for (let i = 0; i < count; i++) {
    const h = hash2D(col, row, i + 11)
    const px = x + 2 + (h % (TILE - 4))
    const py = y + 2 + ((h >>> 8) % (TILE - 4))
    g.fillStyle(h % 2 === 0 ? C.grassSpeck : C.grassSpeckAlt, 0.85)
    g.fillRect(px, py, 2, 2)
  }

  g.lineStyle(1, 0x6b7f67, 0.12)
  g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1)
}

function drawWaterTile(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  col: number,
  row: number,
): void {
  const h = hash2D(col, row, 99)
  const variant = h % 3
  g.fillStyle(variant === 0 ? C.waterBase : variant === 1 ? C.waterDeep : C.waterHighlight, 1)
  g.fillRect(x, y, TILE, TILE)

  for (let i = 0; i < 3; i++) {
    const s = hash2D(col, row, i + 50)
    g.fillStyle(C.waterHighlight, 0.25 + (s % 10) / 30)
    g.fillRect(x + 4 + (s % 28), y + 4 + ((s >>> 4) % 28), 2, 1)
  }
}

function tempGraphics(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  return scene.add.graphics().setVisible(false)
}

/** Bake the full island into one texture (宣纸淡墨绿 + 青花水墨蓝). */
export function buildIslandTexture(scene: Phaser.Scene): void {
  const cols = CANVAS_WIDTH / TILE
  const rows = CANVAS_HEIGHT / TILE
  const g = tempGraphics(scene)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * TILE
      const y = row * TILE
      if (isWaterTile(col, row, cols, rows)) drawWaterTile(g, x, y, col, row)
      else drawGrassTile(g, x, y, col, row)
    }
  }

  if (scene.textures.exists('island-base')) scene.textures.remove('island-base')
  g.generateTexture('island-base', CANVAS_WIDTH, CANVAS_HEIGHT)
  g.destroy()
}

type Pixel = readonly [number, number, number]

function paintPixels(
  g: Phaser.GameObjects.Graphics,
  pixels: readonly Pixel[],
  px: number,
  originX: number,
  originY: number,
): void {
  for (const [x, y, color] of pixels) {
    g.fillStyle(color, 1)
    g.fillRect(originX + x * px, originY + y * px, px, px)
  }
}

/** 共享色板 — 人体结构 */
const BODY = {
  skin: 0xe8c4a0,
  skinShadow: 0xc9907a,
  ink: 0x222222,
  shoe: 0x2a2a2a,
  hat: 0xc4a574,
  hatDark: 0xb8956a,
  strongShirt: 0x8b2e2e,
  strongShirtDark: 0x6b1f1f,
  strongPants: 0x5a4020,
  robe: 0x254a72,
  robeDark: 0x1e3a5f,
  robeHem: 0x142d4a,
  hair: 0x1a1a1a,
  hairPin: 0xd4a843,
  sash: 0xc45c7a,
  lip: 0xcc8888,
  skirt: 0x3a6a92,
  tunic: 0x5a7a52,
  tunicDark: 0x4a6644,
} as const

/** 阿强 — 斗笠壮汉：头 / 双臂 / 双腿 / 脚 */
function drawStrongmanPixels(g: Phaser.GameObjects.Graphics, px: number, ox: number, oy: number): void {
  const { skin: S, skinShadow: SD, ink: I, shoe: F, hat: H, hatDark: Hd, strongShirt: R, strongShirtDark: Rd, strongPants: P } = BODY

  const pixels: Pixel[] = [
    // 斗笠
    [6, 0, H], [7, 0, H], [8, 0, H], [9, 0, H],
    [5, 1, H], [6, 1, H], [7, 1, H], [8, 1, H], [9, 1, H], [10, 1, H],
    [6, 2, Hd], [7, 2, Hd], [8, 2, Hd], [9, 2, Hd],
    // 脸
    [6, 3, S], [7, 3, S], [8, 3, S], [9, 3, S],
    [5, 4, S], [6, 4, S], [7, 4, I], [8, 4, I], [9, 4, S], [10, 4, S],
    [6, 5, SD], [7, 5, SD], [8, 5, SD], [9, 5, SD],
    // 肩 + 胸
    [5, 6, Rd], [6, 6, R], [7, 6, R], [8, 6, R], [9, 6, R], [10, 6, Rd],
    // 双臂（y7-8 伸出）+ 手
    [3, 7, S], [4, 7, S], [5, 7, Rd], [6, 7, R], [7, 7, R], [8, 7, R], [9, 7, R], [10, 7, Rd], [11, 7, S], [12, 7, S],
    [3, 8, SD], [4, 8, SD], [5, 8, Rd], [6, 8, R], [7, 8, R], [8, 8, R], [9, 8, R], [10, 8, Rd], [11, 8, SD], [12, 8, SD],
    // 腰
    [6, 9, R], [7, 9, R], [8, 9, R], [9, 9, R],
    [6, 10, Rd], [7, 10, P], [8, 10, P], [9, 10, Rd],
    // 双腿
    [5, 11, P], [6, 11, P], [9, 11, P], [10, 11, P],
    [5, 12, P], [6, 12, P], [9, 12, P], [10, 12, P],
    // 脚
    [4, 13, F], [5, 13, F], [6, 13, F], [9, 13, F], [10, 13, F], [11, 13, F],
  ]

  paintPixels(g, pixels, px, ox, oy)
}

/** 阿珍 — 女书生：垂挂发髻 / 披肩长发 / 襦裙 / 系带 */
function drawScholarPixels(g: Phaser.GameObjects.Graphics, px: number, ox: number, oy: number): void {
  const {
    skin: S,
    skinShadow: SD,
    ink: I,
    shoe: F,
    robe: R,
    robeDark: Rd,
    robeHem: Rh,
    hair: H,
    hairPin: Pn,
    sash: Sa,
    lip: Lp,
    skirt: Sk,
  } = BODY

  const pixels: Pixel[] = [
    // 发髻（高髻）
    [7, 0, H], [8, 0, H],
    [6, 1, H], [7, 1, H], [8, 1, H], [9, 1, H],
    [8, 1, Pn], // 发簪
    // 额前刘海 + 花钿
    [6, 2, H], [7, 2, H], [8, 2, H], [9, 2, H],
    [7, 2, Lp],
    // 脸（略窄，偏女性比例）
    [6, 3, S], [7, 3, S], [8, 3, S], [9, 3, S],
    [5, 4, H], [6, 4, S], [7, 4, I], [8, 4, I], [9, 4, S], [10, 4, H],
    [6, 5, SD], [7, 5, Lp], [8, 5, SD], [9, 5, SD],
    // 披肩长发（两侧垂下）
    [4, 3, H], [4, 4, H], [4, 5, H], [4, 6, H], [4, 7, H], [4, 8, H],
    [11, 3, H], [11, 4, H], [11, 5, H], [11, 6, H], [11, 7, H], [11, 8, H],
    [5, 5, H], [10, 5, H],
    // 窄肩 + 上襦
    [5, 6, Rd], [6, 6, R], [7, 6, R], [8, 6, R], [9, 6, R], [10, 6, Rd],
    // 广袖 + 纤手
    [3, 7, Sk], [4, 7, Rd], [5, 7, R], [6, 7, R], [7, 7, R], [8, 7, R], [9, 7, R], [10, 7, Rd], [11, 7, Sk],
    [2, 8, S], [3, 8, S], [4, 8, Rd], [5, 8, Sa], [6, 8, Sa], [7, 8, Sa], [8, 8, Sa], [9, 8, Rd], [10, 8, S], [11, 8, S],
    // 齐胸襦裙 — 腰窄裙宽
    [5, 9, R], [6, 9, R], [7, 9, R], [8, 9, R], [9, 9, R], [10, 9, R],
    [4, 10, Sk], [5, 10, Sk], [6, 10, R], [7, 10, R], [8, 10, R], [9, 10, Sk], [10, 10, Sk],
    [3, 11, Sk], [4, 11, Sk], [5, 11, Rh], [6, 11, Rh], [7, 11, Rh], [8, 11, Rh], [9, 11, Sk], [10, 11, Sk], [11, 11, Sk],
    [3, 12, Rh], [4, 12, Rh], [5, 12, Rh], [6, 12, Rh], [7, 12, Rh], [8, 12, Rh], [9, 12, Rh], [10, 12, Rh], [11, 12, Rh],
    // 裙下绣鞋
    [5, 13, F], [6, 13, F], [8, 13, F], [9, 13, F],
  ]

  paintPixels(g, pixels, px, ox, oy)
}

/** 阿衰 — 躺平青年：乱发 / 松垮短衫 / 手垂 / 弯腿 */
function drawSlackerPixels(g: Phaser.GameObjects.Graphics, px: number, ox: number, oy: number): void {
  const { skin: S, skinShadow: SD, ink: I, shoe: F, tunic: T, tunicDark: Td, hair: H } = BODY

  const pixels: Pixel[] = [
    // 乱发
    [6, 1, H], [7, 1, H], [8, 1, H], [9, 1, H],
    [5, 2, H], [6, 2, H], [9, 2, H], [10, 2, H],
    // 脸（略低，懒散感）
    [6, 3, S], [7, 3, S], [8, 3, S], [9, 3, S],
    [5, 4, S], [6, 4, I], [7, 4, S], [8, 4, S], [9, 4, I], [10, 4, S],
    [7, 5, SD], [8, 5, SD],
    // 短衫 + 肩
    [5, 6, Td], [6, 6, T], [7, 6, T], [8, 6, T], [9, 6, T], [10, 6, Td],
    // 双臂下垂 + 手
    [4, 7, S], [5, 7, Td], [6, 7, T], [7, 7, T], [8, 7, T], [9, 7, T], [10, 7, Td], [11, 7, S],
    [4, 8, SD], [5, 8, Td], [6, 8, T], [7, 8, T], [8, 8, T], [9, 8, T], [10, 8, Td], [11, 8, SD],
    [4, 9, SD], [11, 9, SD],
    // 短衫下摆
    [6, 9, T], [7, 9, T], [8, 9, T], [9, 9, T],
    // 弯腿（内八躺平感）
    [5, 10, Td], [6, 10, Td], [9, 10, Td], [10, 10, Td],
    [5, 11, Td], [6, 11, Td], [9, 11, Td], [10, 11, Td],
    [4, 12, Td], [5, 12, Td], [10, 12, Td], [11, 12, Td],
    // 脚
    [3, 13, F], [4, 13, F], [5, 13, F], [10, 13, F], [11, 13, F], [12, 13, F],
  ]

  paintPixels(g, pixels, px, ox, oy)
}

export type NPCRole = 'strongman' | 'scholar' | 'slacker'

export function registerCharacterTextures(scene: Phaser.Scene): void {
  const specs: { key: string; draw: typeof drawStrongmanPixels }[] = [
    { key: 'npc-strongman', draw: drawStrongmanPixels },
    { key: 'npc-scholar', draw: drawScholarPixels },
    { key: 'npc-slacker', draw: drawSlackerPixels },
  ]

  for (const { key, draw } of specs) {
    if (scene.textures.exists(key)) scene.textures.remove(key)
    const g = tempGraphics(scene)
    // 16×16 逻辑网格 × 2px = 32px，留边距居中于 40×40 纹理
    draw(g, 2, 4, 2)
    g.generateTexture(key, 40, 40)
    g.destroy()
  }
}

export function roleTextureKey(role: NPCRole): string {
  return role === 'strongman' ? 'npc-strongman' : role === 'scholar' ? 'npc-scholar' : 'npc-slacker'
}

/** 古松 — 层叠三角墨绿冠 +  brown 树干 */
export function drawPineLandmark(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const px = 4
  g.fillStyle(0x4a3528, 1)
  g.fillRect(x - px, y + px * 2, px * 2, px * 4)

  const layers = [
    { w: 9, color: 0x1a3020, dy: -px * 2 },
    { w: 7, color: 0x2d4b32, dy: -px * 4 },
    { w: 5, color: 0x3a5c3e, dy: -px * 6 },
    { w: 3, color: 0x4a6b4e, dy: -px * 8 },
  ]

  for (const layer of layers) {
    const half = (layer.w * px) / 2
    g.fillStyle(layer.color, 1)
    g.fillTriangle(x, y + layer.dy, x - half, y + layer.dy + layer.w * px * 0.6, x + half, y + layer.dy + layer.w * px * 0.6)
  }
}

/** 岭南书斋 — 镬耳墙轮廓 + 暖黄窗 */
export function drawLibraryLandmark(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const px = 3
  g.lineStyle(2, 0x2a2a2a, 1)
  g.fillStyle(0x5a5a5a, 1)
  g.fillRect(x - px * 5, y, px * 10, px * 7)
  g.strokeRect(x - px * 5, y, px * 10, px * 7)

  g.lineStyle(2, 0x1a1a1a, 1)
  g.strokeEllipse(x - px * 6, y + px * 2, px * 3, px * 5)
  g.strokeEllipse(x + px * 6, y + px * 2, px * 3, px * 5)

  g.fillStyle(0xf5d76e, 1)
  g.fillRect(x - px, y + px * 3, px * 2, px * 2)

  g.fillStyle(0x3a3a3a, 1)
  g.fillTriangle(x, y - px, x - px * 3, y + px, x + px * 3, y + px)
}

/** 竹榻 — 极简 tan 竹格 */
export function drawBambooBedLandmark(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const px = 3
  g.fillStyle(0xc4a574, 1)
  g.fillRect(x - px * 5, y + px, px * 10, px * 2)

  g.lineStyle(1, 0x8b6914, 0.9)
  for (let i = -4; i <= 4; i += 2) {
    g.lineBetween(x + i * px, y + px, x + i * px, y + px * 4)
  }
  for (let j = 0; j <= 3; j++) {
    g.lineBetween(x - px * 4, y + px + j * px, x + px * 4, y + px + j * px)
  }

  g.fillStyle(0xa08050, 1)
  g.fillRect(x - px * 5, y + px * 4, px * 2, px * 2)
  g.fillRect(x + px * 3, y + px * 4, px * 2, px * 2)
}

export function getWaterEdgeTiles(): { col: number; row: number; x: number; y: number }[] {
  const cols = CANVAS_WIDTH / TILE
  const rows = CANVAS_HEIGHT / TILE
  const edges: { col: number; row: number; x: number; y: number }[] = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isWaterEdge(col, row, cols, rows)) {
        edges.push({ col, row, x: col * TILE, y: row * TILE })
      }
    }
  }
  return edges
}

// isWaterTile intentionally not exported — internal only

/** Dynamic map features — used by mapMutation system. */

let mutationCount = 0

/** Campfire — orange glow + 3 logs */
export function drawCampfire(g: Phaser.GameObjects.Graphics): void {
  const baseX = 80 + (mutationCount % 10) * (CANVAS_WIDTH / 10)
  const baseY = 400 + (mutationCount % 5) * 20
  mutationCount++

  const px = 3
  // Logs
  g.fillStyle(0x5a3a20, 1)
  g.fillRect(baseX - px * 2, baseY, px * 4, px)
  g.fillRect(baseX - px, baseY - px, px, px * 3)
  // Fire
  g.fillStyle(0xe8842a, 1)
  g.fillTriangle(baseX, baseY - px * 3, baseX - px, baseY - px, baseX + px, baseY - px)
  g.fillStyle(0xf5c542, 0.8)
  g.fillTriangle(baseX, baseY - px * 2, baseX - px * 0.5, baseY - px, baseX + px * 0.5, baseY - px)
}

/** Woodpile — stacked rectangles */
export function drawWoodpile(g: Phaser.GameObjects.Graphics): void {
  const baseX = 650 + (mutationCount % 8) * 20
  const baseY = 480
  mutationCount++

  const px = 3
  g.fillStyle(0x6b5030, 1)
  // Bottom row
  for (let i = 0; i < 4; i++) g.fillRect(baseX + i * px * 2, baseY, px * 2, px)
  // Top row
  for (let i = 0; i < 3; i++) g.fillRect(baseX + px + i * px * 2, baseY - px, px * 2, px)
}

/** Reset mutation counter (called on game restart). */
export function resetMutationCount(): void {
  mutationCount = 0
}
