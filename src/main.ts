import Phaser from 'phaser'
import './style.css'
import { fetchDivineCommand, fetchEpilogue, fetchIdleEvent, setCustomNameMap } from './api/divineCommand'
import {
  applyStateImpact,
  createInitialGameState,
  evaluateSettlement,
  tickSecond,
  WIN_KNOWLEDGE,
  WIN_WOOD,
  type SettlementResult,
} from './game/survivalState'
import { GameScene, gameConfig } from './scenes/GameScene'
import type {
  AchievementId,
  GameStats,
  Achievement,
  GlobalGameState,
  LLMResponse,
  NPCName,
  QualityFeedback,
  WorldEvent,
} from './types'
import { ALL_ACHIEVEMENTS } from './types'
import { createDifficultyConfig, CHALLENGES } from './game/survivalState'
import type { ChallengeConfig } from './game/survivalState'
import {
  startAmbient,
  updateAmbientIntensity,
  playGong,
  startHeartbeat,
  updateHeartbeatBPM,
  stopHeartbeat,
  startCountdownTicks,
  stopCountdownTicks,
  playVictory,
  playDefeat,
  prepareSound,
  bindButtonSounds,
  stopAll,
  isReady,
} from './audio/soundManager'

/**
 * Prompt Genesis — survival loop + real DeepSeek API bridge.
 *
 * Phaser renders at 60 FPS; LLM fetch runs outside the frame loop.
 * Game timers use setInterval in the DOM layer (also non-blocking).
 */

/* ── Achievement & difficulty system ──────────────────── */

const STORAGE_KEY = 'prompt_genesis_save'

interface NPCPersonalityState { resistance: number }

interface SaveData {
  totalWins: number
  unlocked: AchievementId[]
  difficultyLevel: number
  personality: Record<string, NPCPersonalityState>
  npcNames: Record<string, string>
  challengeWins: Record<string, number>
  worldState?: { forestBurned: boolean; treesPlanted: number; structuresBuilt: number; libraryDamaged: boolean }
  relationships?: { 阿强_阿珍: number; 阿强_阿衰: number; 阿珍_阿衰: number }
}

function defaults(): SaveData {
  return { totalWins: 0, unlocked: [], difficultyLevel: 0, personality: { 阿强: { resistance: 0 }, 阿珍: { resistance: 0 }, 阿衰: { resistance: 0 } }, npcNames: {}, challengeWins: {}, worldState: { forestBurned: false, treesPlanted: 0, structuresBuilt: 0, libraryDamaged: false }, relationships: { 阿强_阿珍: 0, 阿强_阿衰: 0, 阿珍_阿衰: 0 } }
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // Merge with defaults so missing fields (from older saves) are filled
      return { ...defaults(), ...parsed, personality: { ...defaults().personality, ...parsed.personality }, npcNames: { ...defaults().npcNames, ...parsed.npcNames }, challengeWins: { ...defaults().challengeWins, ...parsed.challengeWins }, worldState: { ...defaults().worldState, ...parsed.worldState }, relationships: { ...defaults().relationships, ...parsed.relationships } }
    }
  } catch { /* ignore corrupt data */ }
  return defaults()
}

function writeSave(data: SaveData): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { /* storage full */ }
}

const saveData = loadSave()
let difficultyLevel = saveData.difficultyLevel
let currentDifficulty = createDifficultyConfig(difficultyLevel)

let currentGame: Phaser.Game | null = null
let currentChallenge: ChallengeConfig = CHALLENGES[0]
let gameState = createInitialGameState(currentDifficulty, currentChallenge)
let elapsedSeconds = 0
let clockTimer: number | undefined
let isGameStarted = false
let isFreeMode = false
let isBulletTime = false

/** Prompt history for narrative chronicle & epilogue. */
interface HistoryEntry { prompt: string; quality?: QualityFeedback; worldEvent?: WorldEvent; outcome: string; timeLeft: number }
let promptHistory: HistoryEntry[] = []

/** Per-game stats for achievement checking. */
let desireStats = { total: 0, fulfilled: 0 }
let gameStats: GameStats = {
  promptCount: 0,
  strongmanActions: 0,
  scholarActions: 0,
  slackerActions: 0,
  highestQuality: null,
  totalWins: saveData.totalWins,
}

function checkAchievements(result: SettlementResult): Achievement[] {
  const newlyUnlocked: Achievement[] = []
  const wasWin = result === 'win'

  for (const ach of ALL_ACHIEVEMENTS) {
    if (saveData.unlocked.includes(ach.id)) continue

    let earned = false
    switch (ach.id) {
      case 'first_win':
        earned = wasWin
        break
      case 'mind_reader':
        earned = wasWin && desireStats.total > 0 && desireStats.fulfilled === desireStats.total
        break
      case 'tyrant':
        earned = wasWin && gameStats.scholarActions === 0 && gameStats.slackerActions === 0 && gameStats.strongmanActions > 0
        break
      case 'perfect_scholar':
        earned = wasWin && gameStats.strongmanActions > 0 && gameStats.scholarActions > 0 && gameStats.slackerActions > 0
        break
      case 'gambler':
        earned = wasWin && gameStats.promptCount <= 1
        break
      case 'last_stand':
        earned = wasWin && promptHistory.length === 1 && (promptHistory[0]?.timeLeft ?? 60) <= 10
        break
      case 'survivor':
        earned = wasWin && gameState.hunger < 10
        break
      case 'poet':
        earned = gameStats.highestQuality === '神谕'
        break
    }

    if (earned) {
      saveData.unlocked.push(ach.id)
      newlyUnlocked.push(ach)
    }
  }

  if (wasWin) {
    saveData.totalWins += 1
    gameStats.totalWins = saveData.totalWins
    if (currentChallenge && currentChallenge.id !== 'none') {
      saveData.challengeWins[currentChallenge.id] = (saveData.challengeWins[currentChallenge.id] ?? 0) + 1
    }
    difficultyLevel = Math.min(5, difficultyLevel + 1)
  } else {
    difficultyLevel = Math.max(0, difficultyLevel - 1) // Loss decreases difficulty
  }
  saveData.difficultyLevel = difficultyLevel
  currentDifficulty = createDifficultyConfig(difficultyLevel)

  writeSave(saveData)
  return newlyUnlocked
}

/* ── Placeholder rotation ─────────────────────────────── */

const PLACEHOLDERS = [
  '让阿强去砍树，阿珍去读书，阿衰睡觉恢复体力…',
  '暴风雨来了！强壮的伐木，聪明的读书，剩下的躺平！',
  '阿衰别睡了，去砍树！阿珍去读书！',
  '天降神谕：各司其职，共渡洪水之灾…',
  '全员集合！伐木、读书、蓄力——为了活下去！',
]

let placeholderIndex = 0
let placeholderTimer: ReturnType<typeof setInterval> | null = null

function startPlaceholderRotation(): void {
  stopPlaceholderRotation()
  const input = document.querySelector<HTMLInputElement>('#prompt-input')
  if (!input) return
  placeholderIndex = 0
  input.placeholder = PLACEHOLDERS[0]
  placeholderTimer = setInterval(() => {
    placeholderIndex = (placeholderIndex + 1) % PLACEHOLDERS.length
    input.placeholder = PLACEHOLDERS[placeholderIndex]
  }, 2500)
}

function stopPlaceholderRotation(): void {
  if (placeholderTimer !== null) { clearInterval(placeholderTimer); placeholderTimer = null }
}

function buildLayout(): void {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <div class="bento-shell">
      <header class="bento-header">
        <h1 class="bento-title">Prompt 创世纪</h1>
        <p class="bento-subtitle">神谕沙盒 · 洪水求生</p>
      </header>

      <div class="bento-grid">
        <div class="widget widget-wood">
          <div class="widget-label">木材</div>
          <div id="wood-display" class="stat-value">0 / ${WIN_WOOD}</div>
        </div>

        <div class="widget widget-timer">
          <div class="widget-label">大洪水倒计时</div>
          <span id="timer-display" class="timer-value timer-idle">—</span>
        </div>

        <div class="widget widget-knowledge">
          <div class="widget-label">知识</div>
          <div id="knowledge-display" class="stat-value">0 / ${WIN_KNOWLEDGE}</div>
        </div>

        <div class="widget widget-hunger">
          <div class="widget-label">饱食度</div>
          <div id="hunger-value" class="stat-value stat-value-sm">100%</div>
          <div class="hunger-track">
            <div id="hunger-bar" class="hunger-fill" style="width: 100%"></div>
          </div>
        </div>

        <div class="widget widget-log">
          <div id="world-event-bar" class="hidden"></div>
          <div class="log-scroll">
            <p id="status-line">等待神谕…</p>
          </div>
          <p id="quality-badge"></p>
        </div>

        <div class="widget widget-canvas">
          <div id="game-container">
            <div id="phaser-mount"></div>
            <div id="start-overlay">
              <p class="start-copy">
                大洪水即将降临，你需在 <em>60 秒</em> 内收集足够资源。<br />
                点击下方按钮，倒计时才会开始。
              </p>
              <div class="name-editor">
                <span class="name-field"><label>阿强</label><input id="name-阿强" type="text" maxlength="6" class="name-input" /></span>
                <span class="name-field"><label>阿珍</label><input id="name-阿珍" type="text" maxlength="6" class="name-input" /></span>
                <span class="name-field"><label>阿衰</label><input id="name-阿衰" type="text" maxlength="6" class="name-input" /></span>
              </div>
              <div class="challenge-picker">
                <span class="challenge-label">挑战</span>
                <div class="challenge-options">
                  <button type="button" class="challenge-btn active" data-challenge="none">标准</button>
                  <button type="button" class="challenge-btn" data-challenge="silent_storm">禁言风暴</button>
                  <button type="button" class="challenge-btn" data-challenge="knowledge_first">知识至上</button>
                  <button type="button" class="challenge-btn" data-challenge="hell_30s">30s地狱</button>
                </div>
              </div>
              <div class="start-buttons">
                <button id="start-btn" type="button" class="btn-primary btn-start">开始求生</button>
                <button id="free-btn" type="button" class="btn-secondary btn-start">自由模式 🌿</button>
              </div>
            </div>
          </div>
        </div>

        <div class="widget widget-prompt">
          <label for="prompt-input" class="prompt-label">Divine Command · 神谕</label>
          <input
            id="prompt-input"
            type="text"
            placeholder="输入神谕让信徒活下去…（例：让阿强砍树，阿珍读书，阿衰躺平）"
          />
        </div>

        <div class="widget widget-action">
          <div class="action-row">
            <button id="cast-btn" type="button" class="btn-primary">
              降下神谕 (Cast Prompt)
            </button>
            <button id="voice-btn" type="button" class="voice-btn" title="语音输入神谕">🎤</button>
            <button id="exit-free-btn" type="button" class="exit-free-btn hidden" title="退出自由模式">✕</button>
          </div>
        </div>
      </div>
    </div>

    <div id="reasoning-overlay" class="hidden">
      <div class="reasoning-card">
        <div id="reasoning-content"></div>
      </div>
    </div>

    <div id="modal-overlay" class="hidden">
      <div class="modal-card">
        <h2 id="modal-title"></h2>
        <img id="modal-wallpaper" class="mt-3 w-full rounded-lg" style="image-rendering:pixelated;max-height:160px" />
        <div id="modal-epilogue"></div>
        <hr class="modal-divider" />
        <div id="modal-chronicle"></div>
        <button id="modal-restart" type="button" class="btn-primary" style="margin-top: 1.25rem">
          再来一局
        </button>
      </div>
    </div>
  `
}

function syncScenePressure(game: Phaser.Game): void {
  const scene = game.scene.getScene('GameScene') as GameScene
  if (scene?.scene.isActive()) {
    game.registry.set('timeLeft', gameState.timeLeft)
    // Sync custom NPC names
    const names = saveData.npcNames ?? {}
    for (const n of ['阿强', '阿珍', '阿衰']) {
      if (names[n]) game.registry.set(`npcName_${n}`, names[n])
    }
    // Sync relationship data to GameScene
    const rel = saveData.relationships ?? { 阿强_阿珍: 0, 阿强_阿衰: 0, 阿珍_阿衰: 0 }
    game.registry.set('relationships', rel)
    scene.updateSurvivalPressure(gameState.timeLeft, isGameStarted && !gameState.isGameOver, saveData.personality['阿衰']?.resistance ?? 0)
  }
}

function renderHud(state: GlobalGameState): void {
  const needW = currentDifficulty.needWood
  const needK = currentDifficulty.needKnowledge
  const woodEl = document.querySelector<HTMLDivElement>('#wood-display')!
  woodEl.textContent = `${state.wood} / ${needW}`
  woodEl.classList.toggle('resource-full', state.wood >= needW)

  const knowledgeEl = document.querySelector<HTMLDivElement>('#knowledge-display')!
  knowledgeEl.textContent = `${state.knowledge} / ${needK}`
  knowledgeEl.classList.toggle('resource-full', state.knowledge >= needK)

  const timerEl = document.querySelector<HTMLSpanElement>('#timer-display')!
  if (!isGameStarted) {
    timerEl.textContent = '—'
    timerEl.className = 'timer-value timer-idle'
  } else if (isBulletTime) {
    timerEl.textContent = '⏸ ' + String(state.timeLeft)
    timerEl.className = 'timer-value'
    timerEl.style.color = '#7ec8e3'
  } else if (isFreeMode) {
    timerEl.textContent = '∞'
    timerEl.className = 'timer-value'
    timerEl.style.color = '#7cb88a'
  } else {
    timerEl.textContent = String(state.timeLeft)
    timerEl.className =
      state.timeLeft <= 10 ? 'timer-value timer-critical' : 'timer-value timer-active'
  }

  document.querySelector<HTMLDivElement>('#hunger-value')!.textContent =
    `${Math.round(state.hunger)}%`

  // Show challenge name in timer area
  if (currentChallenge.id !== 'none') {
    timerEl.textContent += ` · ${currentChallenge.name}`
  }

  const bar = document.querySelector<HTMLDivElement>('#hunger-bar')!
  bar.style.width = `${state.hunger}%`
  bar.className =
    state.hunger <= 20
      ? 'hunger-fill hunger-fill--danger'
      : state.hunger <= 50
        ? 'hunger-fill hunger-fill--warn'
        : 'hunger-fill'
}

function showModal(title: string): void {
  const overlay = document.querySelector<HTMLDivElement>('#modal-overlay')!
  document.querySelector<HTMLHeadingElement>('#modal-title')!.textContent = title
  overlay.classList.remove('hidden')
}

function hideModal(): void {
  document.querySelector<HTMLDivElement>('#modal-overlay')!.classList.add('hidden')
}

function setPromptControlsEnabled(enabled: boolean): void {
  const input = document.querySelector<HTMLInputElement>('#prompt-input')!
  const castBtn = document.querySelector<HTMLButtonElement>('#cast-btn')!
  const canInteract = enabled && isGameStarted && !gameState.isGameOver
  input.disabled = !canInteract
  castBtn.disabled = !canInteract
  castBtn.textContent = enabled ? '降下神谕 (Cast Prompt)' : '神明思考中 (LLM Reasoning)...'
  castBtn.classList.toggle('btn-thinking', !enabled)
}

function showStartOverlay(): void {
  document.querySelector<HTMLDivElement>('#start-overlay')!.classList.remove('hidden')
}

function hideStartOverlay(): void {
  document.querySelector<HTMLDivElement>('#start-overlay')!.classList.add('hidden')
}

function stopSurvivalClock(): void {
  if (clockTimer !== undefined) {
    window.clearInterval(clockTimer)
    clockTimer = undefined
  }
}

/* ── Ending wallpaper ─────────────────────────────────── */

function generateEndingWallpaper(result: string): string {
  const W = 400, H = 160
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#1a1a2e'); grad.addColorStop(0.5, '#2c4a5e'); grad.addColorStop(1, '#4a6b5a')
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H)
  // Moon
  ctx.fillStyle = '#f5f0e6'; ctx.beginPath(); ctx.arc(320, 40, 20, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#2c4a5e'; ctx.beginPath(); ctx.arc(328, 36, 17, 0, Math.PI * 2); ctx.fill()

  if (result === 'win') {
    ctx.fillStyle = '#5a3a20'; ctx.fillRect(150, 80, 100, 40)
    ctx.fillStyle = '#4a2a10'
    for (let i = 0; i < 4; i++) ctx.fillRect(160 + i * 22, 70, 16, 10)
    ctx.fillStyle = '#1a1a1a'
    for (const x of [170, 190, 210]) ctx.fillRect(x, 108, 6, 12)
    ctx.fillStyle = '#1e3340'; ctx.fillRect(0, 120, W, 40)
    ctx.fillStyle = '#f5f0e6'
    for (let i = 0; i < 12; i++) ctx.fillRect(20 + i * 32, 10 + (i % 3) * 14, 2, 2)
  } else if (result === 'lose_hunger') {
    ctx.fillStyle = '#5a5a5a'; ctx.fillRect(260, 80, 30, 35)
    ctx.fillStyle = '#f5d76e'; ctx.fillRect(268, 90, 6, 6)
    ctx.fillStyle = '#2a2a2a'
    for (const x of [180, 200, 220]) ctx.fillRect(x, 100 + (x === 200 ? 4 : 2), 14, 4)
    ctx.fillStyle = '#3a3a3a'
    for (let i = 0; i < 20; i++) ctx.fillRect(30 + i * 18, 100 + (i % 4) * 8, 2, 2)
  } else {
    ctx.fillStyle = '#1e3340'; ctx.fillRect(0, 60, W, 100)
    ctx.fillStyle = '#2c4a5e'; ctx.fillRect(0, 50, W, 20)
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(60, 70, 25, 30); ctx.fillRect(140, 80, 25, 20); ctx.fillRect(280, 60, 30, 40)
    ctx.fillStyle = '#1a1a1a'
    for (let i = 0; i < 30; i++) {
      ctx.globalAlpha = 0.2 + Math.random() * 0.3
      ctx.beginPath(); ctx.arc(Math.random() * W, 40 + Math.random() * 80, 1 + Math.random() * 3, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  return c.toDataURL('image/png')
}

const WORLD_EVENT_ICONS: Record<string, string> = {
  STORM: '⛈️',
  FLOOD_SURGE: '🌊',
  WILD_BOAR: '🐗',
  SUPPLY_CACHE: '📦',
  RAIN: '🌧️',
  MOONLIGHT: '🌙',
  DROUGHT: '🏜️',
  FIND_SUPPLIES: '🎒',
}

const QUALITY_BADGES: Record<string, { icon: string; class: string }> = {
  '普通': { icon: '📜', class: 'quality-normal' },
  '优秀': { icon: '✨', class: 'quality-good' },
  '神谕': { icon: '🌟', class: 'quality-divine quality-glow' },
}

function showQualityBadge(quality: QualityFeedback): void {
  const el = document.querySelector<HTMLParagraphElement>('#quality-badge')!
  if (!el) return
  const badge = QUALITY_BADGES[quality.rating]
  if (!badge) return
  el.className = badge.class
  el.textContent = `${badge.icon} ${quality.rating} · ${quality.comment ?? (quality.rating === '神谕' ? '字字珠玑，天地动容' : quality.rating === '优秀' ? '此谕有理有据' : '')}`
}

function clearQualityBadge(): void {
  const el = document.querySelector<HTMLParagraphElement>('#quality-badge')!
  if (el) { el.textContent = ''; el.className = '' }
}

/* ── LLM Reasoning Visualization ──────────────────────── */

function buildReasoningSteps(response: LLMResponse, prompt: string): string[] {
  const icon = response.quality ? (response.quality.rating === '神谕' ? '🌟' : response.quality.rating === '优秀' ? '✨' : '📜') : '📜'
  return [
    `<div class="reasoning-step"><span class="reasoning-step-title">🔍 步骤 1/4：解析神谕</span><br/><span class="reasoning-step-body">${prompt}</span></div>`,
    `<div class="reasoning-step"><span class="reasoning-step-title">🎯 步骤 2/4：识别目标</span><br/><span class="reasoning-step-body">${response.commands.map((cmd: { npcName: string; action: string; animationType?: string; targetX?: number; targetY?: number }) => `${cmd.npcName} → ${cmd.action}${cmd.animationType ? '（' + cmd.animationType + '）' : ''}${cmd.targetX ? ' @[' + cmd.targetX + ',' + cmd.targetY + ']' : ''}`).join('<br/>')}</span></div>`,
    `<div class="reasoning-step"><span class="reasoning-step-title">⚖️ 步骤 3/4：计算影响</span><br/><span class="reasoning-step-body">木材 ${response.stateImpact.woodDelta >= 0 ? '+' : ''}${response.stateImpact.woodDelta}，知识 ${response.stateImpact.knowledgeDelta >= 0 ? '+' : ''}${response.stateImpact.knowledgeDelta}，饱食度 ${response.stateImpact.hungerDelta >= 0 ? '+' : ''}${response.stateImpact.hungerDelta}${response.quality ? ` ${icon} ${response.quality.rating}` : ''}</span></div>`,
    `<div class="reasoning-step"><span class="reasoning-step-title">✅ 步骤 4/4：神谕已降下</span><br/><span class="reasoning-step-body">${response.commands.length} 条指令等待执行${response.afterShock ? ' ⚡+余震' : ''}${response.trade ? ' 🔄+兑换' : ''}</span></div>`,
  ]
}

function showReasoningOverlay(response: LLMResponse, prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.querySelector<HTMLDivElement>('#reasoning-overlay')!
    const content = document.querySelector<HTMLDivElement>('#reasoning-content')!
    if (!overlay || !content) { resolve(); return }

    const steps = buildReasoningSteps(response, prompt)
    overlay.classList.remove('hidden')
    content.innerHTML = ''

    let stepIndex = 0
    const showNext = (): void => {
      if (stepIndex >= steps.length) {
        setTimeout(() => {
          overlay.classList.add('hidden')
          resolve()
        }, 600)
        return
      }
      content.innerHTML = steps.slice(0, stepIndex + 1).join('')
      stepIndex++
      setTimeout(showNext, 350)
    }
    showNext()
  })
}

let worldEventTimer: ReturnType<typeof setTimeout> | undefined

function showWorldEvent(event: WorldEvent): void {
  const bar = document.querySelector<HTMLDivElement>('#world-event-bar')!
  if (!bar) return

  // Clear previous timer so new event doesn't get hidden too early
  if (worldEventTimer !== undefined) clearTimeout(worldEventTimer)

  const icon = WORLD_EVENT_ICONS[event.type] ?? '✨'
  bar.textContent = `${icon} ${event.narrative}`
  bar.classList.remove('hidden')

  worldEventTimer = setTimeout(() => {
    bar.classList.add('hidden')
  }, 5000)
}

function handleSettlement(result: SettlementResult): void {
  if (result === 'playing') return

  gameState = { ...gameState, isGameOver: true }
  stopSurvivalClock()
  stopCountdownTicks()
  setPromptControlsEnabled(false)
  clearQualityBadge()
  stopHeartbeat()
  if (result === 'win') playVictory()
  else playDefeat()

  // Update NPC relationships
  const rel = saveData.relationships ?? { 阿强_阿珍: 0, 阿强_阿衰: 0, 阿珍_阿衰: 0 }
  if (gameStats.strongmanActions > 0 && gameStats.scholarActions > 0) rel.阿强_阿珍 += 1
  else if (gameStats.strongmanActions > 0 || gameStats.scholarActions > 0) rel.阿强_阿珍 = Math.max(rel.阿强_阿珍 - 1, -100)
  if (gameStats.strongmanActions > 0 && gameStats.slackerActions > 0) rel.阿强_阿衰 += 1
  if (gameStats.scholarActions > 0 && gameStats.slackerActions > 0) rel.阿珍_阿衰 += 1
  saveData.relationships = { 阿强_阿珍: Math.max(-100, Math.min(100, rel.阿强_阿珍)), 阿强_阿衰: Math.max(-100, Math.min(100, rel.阿强_阿衰)), 阿珍_阿衰: Math.max(-100, Math.min(100, rel.阿珍_阿衰)) }

  // Update NPC personality on settlement
  if (gameStats.slackerActions > 0) {
    // Slacker was assigned actions this round — increase resistance
    saveData.personality['阿衰'].resistance = Math.min(100, (saveData.personality['阿衰'].resistance ?? 0) + 15)
  } else {
    // Slacker got to rest — decrease resistance
    saveData.personality['阿衰'].resistance = Math.max(0, (saveData.personality['阿衰'].resistance ?? 0) - 10)
  }
  writeSave(saveData)

  // Read secret desire stats from scene
  if (currentGame) {
    const scene = currentGame.scene.getScene('GameScene') as GameScene | null
    if (scene && typeof scene.getTotalDesireCount === 'function') {
      desireStats = { total: scene.getTotalDesireCount(), fulfilled: scene.getFulfilledDesireCount() }
    }
  }

  // Check achievements
  const newAchievements = checkAchievements(result)

  // Build chronicle HTML
  const achievementsHtml = newAchievements.length > 0
    ? `<div class="modal-achievements">
        <div class="modal-achievements-title">🏆 新成就</div>
        ${newAchievements.map(a => `<div class="modal-achievement-item">${a.icon} ${a.name} — ${a.condition}</div>`).join('')}
       </div>`
    : ''
  const chronicleHtml = promptHistory.length > 0
    ? promptHistory.map((h, i) => {
        const qualityIcon = h.quality ? QUALITY_BADGES[h.quality.rating]?.icon ?? '' : ''
        const eventIcon = h.worldEvent ? ' 🌍' : ''
        return `<div class="chronicle-entry">第${i + 1}谕：<span class="chronicle-prompt">${h.prompt}</span>${qualityIcon}${eventIcon}</div>`
      }).join('') + `<div class="chronicle-footer">共 ${promptHistory.length} 道神谕</div>`
    : '<div class="chronicle-empty">未降下任何神谕</div>'

  document.querySelector<HTMLDivElement>('#modal-chronicle')!.innerHTML = chronicleHtml + achievementsHtml

  const titleMap: Record<string, string> = {
    win: '🎉 文明延续',
    lose_hunger: '💀 末日湮灭',
    lose_timeout: '🌊 大洪水降临',
  }
  const title = titleMap[result] ?? '结局'
  document.querySelector<HTMLHeadingElement>('#modal-title')!.textContent = title

  // Generate ending wallpaper
  const wallpaperEl = document.querySelector<HTMLImageElement>('#modal-wallpaper')!
  if (wallpaperEl) wallpaperEl.src = generateEndingWallpaper(result)

  // Fetch epilogue from API (falls back to static)
  const epilogueEl = document.querySelector<HTMLDivElement>('#modal-epilogue')!
  epilogueEl.textContent = '📖 史官执笔中…'

  const epilogueData = {
    outcome: result,
    wood: gameState.wood,
    knowledge: gameState.knowledge,
    hunger: Math.round(gameState.hunger),
    promptsCast: promptHistory.length,
    history: promptHistory.map(h => ({
      prompt: h.prompt,
      quality: h.quality,
      worldEvent: h.worldEvent,
    })),
  }

  fetchEpilogue(epilogueData).then((narrative) => {
    epilogueEl.textContent = narrative || (result === 'win'
      ? '木材与知识均达到 3，信徒们在洪水中守住了火种！'
      : result === 'lose_hunger'
        ? '信徒已全饿死。下次请更合理地分配神谕。'
        : `资源不足（木材 ${gameState.wood}/${WIN_WOOD}，知识 ${gameState.knowledge}/${WIN_KNOWLEDGE}）。文明未能延续。`)
  })

  showModal(title)
}

let isCountdownTicking = false
let lastPromptTime = 0
let idleWhisperTimer: ReturnType<typeof setTimeout> | null = null
let idleSkipCount = 0

function showWhisper(text: string): void {
  let el = document.querySelector<HTMLDivElement>('#world-whisper')
  if (!el) {
    el = document.createElement('div')
    el.id = 'world-whisper'
    el.className = 'whisper-text'
    document.querySelector('#status-line')?.after(el)
  }
  el.textContent = `💭 ${text}`
  el.classList.remove('hidden')
  if (idleWhisperTimer) clearTimeout(idleWhisperTimer)
  idleWhisperTimer = setTimeout(() => { el?.classList.add('hidden') }, 6000)
}

function clearWhisper(): void {
  const el = document.querySelector<HTMLDivElement>('#world-whisper')
  if (el) { el.classList.add('hidden'); el.textContent = '' }
  if (idleWhisperTimer) { clearTimeout(idleWhisperTimer); idleWhisperTimer = null }
}

function startSurvivalClock(game: Phaser.Game): void {
  stopSurvivalClock()
  isCountdownTicking = false

  clockTimer = window.setInterval(() => {
    if (!isGameStarted || gameState.isGameOver) return

    elapsedSeconds += 1
    if (isBulletTime) {
      // Bullet Time — world frozen, no tick
    } else if (!isFreeMode) {
      const drainRate = currentChallenge.drainRate ?? currentDifficulty.drainRate
      gameState = tickSecond(gameState, elapsedSeconds, drainRate)
    }

    // Sync Bullet Time state to GameScene
    if (currentGame) currentGame.registry.set('bulletTime', isBulletTime)

    // Sync world mutations from GameScene into saveData
    if (currentGame) {
      const wm = currentGame.registry.get('worldMutation') as { type: string; description?: string } | undefined
      if (wm) {
        const ws = saveData.worldState ?? { forestBurned: false, treesPlanted: 0, structuresBuilt: 0, libraryDamaged: false }
        if (wm.type === 'BUILD') ws.structuresBuilt += 1
        else if (wm.type === 'GROW_TREE') ws.treesPlanted += 1
        else if (wm.type === 'BURN') ws.forestBurned = true
        else if (wm.type === 'CHOP_TREE') ws.treesPlanted = Math.max(0, ws.treesPlanted - 1)
        saveData.worldState = ws
        writeSave(saveData)
        // Show mutation feedback in status line
        if (wm.description) {
          const sl = document.querySelector<HTMLParagraphElement>('#status-line')
          if (sl) sl.textContent = wm.description
        }
        currentGame.registry.set('worldMutation', undefined)
      }
    }

    // Apply proactive NPC impacts from GameScene
    if (currentGame) {
      const pi = currentGame.registry.get('proactiveImpact') as { wood: number; knowledge: number; hunger: number } | undefined
      if (pi && (pi.wood !== 0 || pi.knowledge !== 0 || pi.hunger !== 0)) {
        gameState = applyStateImpact(gameState, { woodDelta: pi.wood, knowledgeDelta: pi.knowledge, hungerDelta: pi.hunger })
        renderHud(gameState)
        currentGame.registry.set('proactiveImpact', { wood: 0, knowledge: 0, hunger: 0 })
      }
    }

    if (isReady()) {
      updateAmbientIntensity(gameState.timeLeft)
      updateHeartbeatBPM(gameState.timeLeft)

      const inFinalTen = gameState.timeLeft <= 10 && gameState.timeLeft > 0
      if (inFinalTen && !isCountdownTicking) {
        startCountdownTicks()
        isCountdownTicking = true
      } else if (!inFinalTen && isCountdownTicking) {
        stopCountdownTicks()
        isCountdownTicking = false
      }
    }

    renderHud(gameState)
    syncScenePressure(game)
    handleSettlement(evaluateSettlement(gameState, currentDifficulty, currentChallenge))

    // AI Game Master — idle narrative every ~30s
    const idleSec = elapsedSeconds - lastPromptTime
    if (idleSec >= 15 && idleSec % 10 === 0 && idleSkipCount % 3 === 0 && isGameStarted && !gameState.isGameOver) {
      fetchIdleEvent({ timeLeft: gameState.timeLeft, wood: gameState.wood, knowledge: gameState.knowledge, hunger: Math.round(gameState.hunger) })
        .then(text => { if (text) showWhisper(text) })
    }
    idleSkipCount++
  }, 1000)
}

function startGame(game: Phaser.Game, freeMode = false): void {
  isFreeMode = freeMode
  // Show exit button in free mode
  const exitBtn = document.querySelector<HTMLButtonElement>('#exit-free-btn')
  if (exitBtn) exitBtn.classList.toggle('hidden', !freeMode)

  // Read selected challenge from picker
  const activeBtn = document.querySelector<HTMLButtonElement>('.challenge-btn.active')
  const challengeId = activeBtn?.getAttribute('data-challenge') ?? 'none'
  currentChallenge = CHALLENGES.find(c => c.id === challengeId) ?? CHALLENGES[0]

  isGameStarted = true
  hideStartOverlay()
  renderHud(gameState)
  syncScenePressure(game)
  setPromptControlsEnabled(true)
  prepareSound()
  startAmbient()
  startHeartbeat()
  startSurvivalClock(game) // clock always runs for proactive behaviours + idle events
}

function restartGame(game: Phaser.Game): void {
  hideModal()
  stopAll()
  stopSurvivalClock()
  isCountdownTicking = false
  isGameStarted = false
  isFreeMode = false
  isBulletTime = false
  const exitBtn = document.querySelector<HTMLButtonElement>('#exit-free-btn')
  if (exitBtn) exitBtn.classList.add('hidden')
  lastPromptTime = 0
  idleSkipCount = 0
  clearWhisper()
  currentDifficulty = createDifficultyConfig(difficultyLevel)
  gameState = createInitialGameState(currentDifficulty, currentChallenge)
  elapsedSeconds = 0
  promptHistory = []
  gameStats = {
    promptCount: 0,
    strongmanActions: 0,
    scholarActions: 0,
    slackerActions: 0,
    highestQuality: null,
    totalWins: saveData.totalWins,
  }
  renderHud(gameState)
  setPromptControlsEnabled(false)
  showStartOverlay()
  document.querySelector<HTMLInputElement>('#prompt-input')!.value = ''
  document.querySelector<HTMLParagraphElement>('#status-line')!.textContent = ''
  clearQualityBadge()
  const wp = document.querySelector<HTMLImageElement>('#modal-wallpaper')
  if (wp) wp.src = ''
  document.querySelector<HTMLDivElement>('#world-event-bar')?.classList.add('hidden')
  game.scene.stop('GameScene')
  game.scene.start('GameScene')
  requestAnimationFrame(() => syncScenePressure(game))
}

function bindPromptBridge(game: Phaser.Game): void {
  const input = document.querySelector<HTMLInputElement>('#prompt-input')!
  const castBtn = document.querySelector<HTMLButtonElement>('#cast-btn')!
  const statusLine = document.querySelector<HTMLParagraphElement>('#status-line')!
  const voiceBtn = document.querySelector<HTMLButtonElement>('#voice-btn')!
  const exitFreeBtn = document.querySelector<HTMLButtonElement>('#exit-free-btn')!
  const restartBtn = document.querySelector<HTMLButtonElement>('#modal-restart')!
  const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')
  if (!startBtn) {
    console.error('[Prompt Genesis] #start-btn not found — start overlay may be blocked by canvas')
    return
  }

  // Bullet Time — focus input freezes the world, blur resumes
  input.addEventListener('focus', () => {
    if (isGameStarted && !gameState.isGameOver) {
      isBulletTime = true
    }
  })
  input.addEventListener('blur', () => {
    isBulletTime = false
  })

  // Voice input via Web Speech API
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (SpeechRecognition && voiceBtn) {
    voiceBtn.disabled = false
    const recognizer = new SpeechRecognition()
    recognizer.lang = 'zh-CN'
    recognizer.continuous = false
    recognizer.interimResults = false
    voiceBtn.addEventListener('click', () => {
      if (!isGameStarted || gameState.isGameOver) return
      isBulletTime = true  // Freeze the world while listening
      voiceBtn.textContent = '🎤…'
      voiceBtn.classList.add('listening')
      recognizer.start()
    })
    recognizer.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? ''
      input.value = transcript
      voiceBtn.textContent = '🎤'
      voiceBtn.classList.remove('listening')
      // Auto-cast after voice input
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' })
      input.dispatchEvent(enterEvent)
    }
    recognizer.onerror = () => {
      voiceBtn.textContent = '🎤'
      voiceBtn.classList.remove('listening')
      if (document.activeElement !== input) isBulletTime = false
    }
    recognizer.onend = () => {
      voiceBtn.textContent = '🎤'
      voiceBtn.classList.remove('listening')
      if (document.activeElement !== input) isBulletTime = false
    }
  }

  renderHud(gameState)
  syncScenePressure(game)
  setPromptControlsEnabled(false)

  startPlaceholderRotation()
  bindButtonSounds(startBtn, castBtn, restartBtn)

  // Build reverse-name map for LLM responses (custom name → original)
  const reverseNames: Record<string, NPCName> = {}
  for (const orig of ['阿强', '阿珍', '阿衰'] as NPCName[]) {
    const custom = saveData.npcNames[orig]
    if (custom && custom !== orig) reverseNames[custom] = orig
  }
  setCustomNameMap(reverseNames)

  // Load custom NPC names into inputs
  const defaultNames = ['阿强', '阿珍', '阿衰']
  for (const name of defaultNames) {
    const input = document.querySelector<HTMLInputElement>(`#name-${name}`)
    if (input) {
      input.value = saveData.npcNames[name] ?? name
      input.addEventListener('change', () => {
        saveData.npcNames[name] = input.value.trim() || name
        writeSave(saveData)
      })
    }
  }

  // Challenge picker
  const challengeBtns = document.querySelectorAll<HTMLButtonElement>('.challenge-btn')
  for (const btn of challengeBtns) {
    btn.addEventListener('click', () => {
      challengeBtns.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
    })
  }

  startBtn.addEventListener('click', () => startGame(game))
  const freeBtn = document.querySelector<HTMLButtonElement>('#free-btn')
  if (freeBtn) freeBtn.addEventListener('click', () => startGame(game, true))
  exitFreeBtn.addEventListener('click', () => restartGame(game))

  const castPrompt = async (): Promise<void> => {
    if (!isGameStarted || gameState.isGameOver) return

    const prompt = input.value.trim()
    if (!prompt) {
      statusLine.textContent = '请先输入神谕。'
      return
    }

    // Enforce challenge prompt limit
    if (currentChallenge.maxPrompts && gameStats.promptCount >= currentChallenge.maxPrompts) {
      statusLine.textContent = `⚠️ 挑战"${currentChallenge.name}"限 ${currentChallenge.maxPrompts} 条神谕，已用尽！`
      setPromptControlsEnabled(true)
      return
    }

    setPromptControlsEnabled(false)
    statusLine.textContent = '神明正在思考中…'

    try {
      const customNames = saveData.npcNames ?? {}
      const ws = saveData.worldState
      const worldDesc = ws ? (ws.forestBurned ? '森林已被烧毁，' : '') + (ws.structuresBuilt > 0 ? `${ws.structuresBuilt} 座建筑已搭建，` : '') + (ws.treesPlanted > 0 ? `${ws.treesPlanted} 棵新树已生长` : '') : ''
      const rel = saveData.relationships ?? { 阿强_阿珍: 0, 阿强_阿衰: 0, 阿珍_阿衰: 0 }
      const relDesc = rel ? `阿强与阿珍关系${rel.阿强_阿珍}，阿强与阿衰关系${rel.阿强_阿衰}，阿珍与阿衰关系${rel.阿珍_阿衰}` : ''
      const npcState = {
        worldState: worldDesc,
        relationships: relDesc,
        阿强: { actions: gameStats.strongmanActions, customName: customNames['阿强'] },
        阿珍: { actions: gameStats.scholarActions, customName: customNames['阿珍'] },
        阿衰: { actions: gameStats.slackerActions, resistance: saveData.personality['阿衰']?.resistance ?? 0, customName: customNames['阿衰'] },
      }
      const recentHistory = promptHistory.slice(-3).map(h => h.prompt)
      const response = await fetchDivineCommand(prompt, npcState, recentHistory)

      // Base impact from NPC actions
      let totalImpact = response.stateImpact
      // Add world event impact if present
      if (response.worldEvent) {
        const ev = response.worldEvent
        totalImpact = {
          woodDelta: totalImpact.woodDelta + ev.stateImpact.woodDelta,
          knowledgeDelta: totalImpact.knowledgeDelta + ev.stateImpact.knowledgeDelta,
          hungerDelta: totalImpact.hungerDelta + ev.stateImpact.hungerDelta,
        }
        showWorldEvent(ev)
      }

      // Show reasoning overlay before executing
      await showReasoningOverlay(response, prompt)

      gameState = applyStateImpact(gameState, totalImpact)
      renderHud(gameState)

      const scene = game.scene.getScene('GameScene') as GameScene | null
      if (scene) {
        scene.executeAICommands(response)
      } else {
        console.error('[Prompt Genesis] GameScene not found — commands not executed')
      }

      // Divine gong — sound of the gods answering
      playGong()

      // Track history for narrative chronicle
      promptHistory.push({
        prompt,
        quality: response.quality,
        worldEvent: response.worldEvent,
        outcome: response.eventName,
        timeLeft: gameState.timeLeft,
      })

      // Track per-game stats for achievements
      gameStats.promptCount += 1
      for (const cmd of response.commands) {
        if (cmd.npcName === '阿强') gameStats.strongmanActions += 1
        else if (cmd.npcName === '阿珍') gameStats.scholarActions += 1
        else if (cmd.npcName === '阿衰') gameStats.slackerActions += 1
      }
      if (response.quality) {
        if (!gameStats.highestQuality || (
          response.quality.rating === '神谕' || (response.quality.rating === '优秀' && gameStats.highestQuality === '普通')
        )) {
          gameStats.highestQuality = response.quality.rating
        }
      }

      // Apply resource trade if present
      let tradeNote = ''
      if (response.trade) {
        const t = response.trade
        const fromDelta = { wood: 0, knowledge: 0, hunger: 0 }
        const toDelta = { wood: 0, knowledge: 0, hunger: 0 }
        fromDelta[t.from] = -t.fromAmount
        toDelta[t.to] = t.toAmount
        const tradeImpact = { woodDelta: fromDelta.wood + toDelta.wood, knowledgeDelta: fromDelta.knowledge + toDelta.knowledge, hungerDelta: fromDelta.hunger + toDelta.hunger }
        gameState = applyStateImpact(gameState, tradeImpact)
        renderHud(gameState)
        tradeNote = ` | ${t.from} -${t.fromAmount} → ${t.to} +${t.toAmount}`
      }

      isBulletTime = false
      if (currentGame) currentGame.registry.set('bulletTime', false) // instant sync, not waiting for clock tick
      lastPromptTime = elapsedSeconds
      clearWhisper()

      // Social contagion: 阿强 produces less when near grumpy 阿衰
      if (currentGame?.registry.get('socialContagion') && response.commands.some(c => c.npcName === '阿强')) {
        const penalty = Math.max(0, Math.floor(totalImpact.woodDelta * 0.3))
        totalImpact = { ...totalImpact, woodDelta: totalImpact.woodDelta - penalty }
      }

      // 阿珍 counseling: reduces 阿衰 resistance when they interact nicely
      const hasZhenTalk = response.commands.some(c => c.npcName === '阿珍' && c.action === 'SPEAK')
      const hasShuai = response.commands.some(c => c.npcName === '阿衰')
      if (hasZhenTalk && hasShuai && response.quality && response.quality.rating !== '普通') {
        saveData.personality['阿衰'].resistance = Math.max(0, (saveData.personality['阿衰'].resistance ?? 0) - 15)
        writeSave(saveData)
      }

      // Schedule afterShock if present
      if (response.afterShock) {
        const { delayMs, worldEvent } = response.afterShock
        setTimeout(() => {
          showWorldEvent(worldEvent)
          gameState = applyStateImpact(gameState, worldEvent.stateImpact)
          renderHud(gameState)
          const scene = game.scene.getScene('GameScene') as GameScene
          scene.onWorldEvent(worldEvent)
          handleSettlement(evaluateSettlement(gameState, currentDifficulty, currentChallenge))
          statusLine.textContent = `⚡ 神谕余震：${worldEvent.narrative}`
        }, delayMs)
      }

      // Show quality badge
      if (response.quality) {
        showQualityBadge(response.quality)
      } else {
        clearQualityBadge()
      }

      const offlineNote = response.eventName.startsWith('offline_')
        ? ' ⚠️ 网络不稳定，已切换本地解析'
        : ''

      const qualityTag = response.quality ? ` 📜${response.quality.rating}` : ''
      statusLine.textContent =
        `事件「${response.eventName}」→ ${response.commands.length} 条指令 | 木材${totalImpact.woodDelta >= 0 ? '+' : ''}${totalImpact.woodDelta} 知识${totalImpact.knowledgeDelta >= 0 ? '+' : ''}${totalImpact.knowledgeDelta} 饱食${totalImpact.hungerDelta >= 0 ? '+' : ''}${totalImpact.hungerDelta}${response.worldEvent ? ' 🌍+事件' : ''}${qualityTag}${tradeNote}${offlineNote}`

      handleSettlement(evaluateSettlement(gameState, currentDifficulty, currentChallenge))
    } catch (error) {
      console.error('[Prompt Genesis]', error)
      const msg = error instanceof Error ? error.message : '未知错误'
      statusLine.textContent = `神谕连接失败：${msg}`
      isBulletTime = false
      if (currentGame) currentGame.registry.set('bulletTime', false)
    } finally {
      if (!gameState.isGameOver) setPromptControlsEnabled(true)
    }
  }

  castBtn.addEventListener('click', () => void castPrompt())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void castPrompt()
  })
  restartBtn.addEventListener('click', () => restartGame(game))
}

buildLayout()

new Phaser.Game({
  ...gameConfig,
  callbacks: {
    postBoot: (bootGame) => {
      currentGame = bootGame
      bindPromptBridge(bootGame)
    },
  },
})
