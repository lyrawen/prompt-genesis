/**
 * Prompt Genesis — LLM ↔ Phaser Communication Contract
 *
 * Strict symmetry between AI reasoning output and Phaser game-state updates.
 * All fields are JSON-serializable string-literal unions (no runtime enums).
 */

export type NPCName = '阿强' | '阿珍' | '阿衰'
export type NPCAction = 'WALK_TO' | 'PLAY_ANIMATION' | 'SPEAK' | 'IDLE'
export type AnimationType = 'CHOP' | 'READ' | 'SLEEP' | 'IDLE'

export interface NPCCommand {
  npcName: NPCName
  action: NPCAction
  targetX?: number
  targetY?: number
  animationType?: AnimationType
  bubbleText?: string
}

export interface StateImpact {
  woodDelta: number
  knowledgeDelta: number
  hungerDelta: number
}

export type WorldEventType =
  | 'STORM'
  | 'FLOOD_SURGE'
  | 'WILD_BOAR'
  | 'SUPPLY_CACHE'
  | 'RAIN'
  | 'MOONLIGHT'
  | 'DROUGHT'
  | 'FIND_SUPPLIES'

export interface WorldEvent {
  type: WorldEventType
  narrative: string
  stateImpact: StateImpact
}

export type QualityRating = '普通' | '优秀' | '神谕'

export interface QualityFeedback {
  rating: QualityRating
  comment?: string
}

export interface AfterShock {
  delayMs: number
  worldEvent: WorldEvent
}

export interface ResourceTrade {
  from: 'wood' | 'knowledge' | 'hunger'
  to: 'wood' | 'knowledge' | 'hunger'
  fromAmount: number
  toAmount: number
  narrative: string
}

export type MapMutationType = 'GROW_TREE' | 'CHOP_TREE' | 'BUILD' | 'BURN' | 'REPAIR'
export type MapTarget = 'forest' | 'library' | 'camp' | 'grass'

export interface MapMutation {
  type: MapMutationType
  target: MapTarget
  description: string
}

export interface LLMResponse {
  eventName: string
  commands: NPCCommand[]
  stateImpact: StateImpact
  worldEvent?: WorldEvent
  quality?: QualityFeedback
  afterShock?: AfterShock
  trade?: ResourceTrade
  mapMutation?: MapMutation
}

export interface EpilogueRequest {
  outcome: 'win' | 'lose_timeout' | 'lose_hunger'
  wood: number
  knowledge: number
  hunger: number
  promptsCast: number
  history: { prompt: string; quality?: QualityFeedback; worldEvent?: WorldEvent }[]
}

export interface GlobalGameState {
  wood: number
  knowledge: number
  hunger: number
  timeLeft: number
  isGameOver: boolean
}

export interface WorldState {
  forestBurned: boolean
  treesPlanted: number
  structuresBuilt: number
  libraryDamaged: boolean
}

/* ── Achievements ─────────────────────────────────────── */

export type AchievementId =
  | 'first_win'
  | 'mind_reader'
  | 'tyrant'
  | 'perfect_scholar'
  | 'gambler'
  | 'last_stand'
  | 'survivor'
  | 'poet'

export interface Achievement {
  id: AchievementId
  name: string
  icon: string
  condition: string
}

export interface GameStats {
  promptCount: number
  strongmanActions: number
  scholarActions: number
  slackerActions: number
  highestQuality: QualityRating | null
  totalWins: number
}

export const ALL_ACHIEVEMENTS: Achievement[] = [
  { id: 'first_win', name: '初露锋芒', icon: '🎯', condition: '第一次胜利' },
  { id: 'mind_reader', name: '读心者', icon: '🔮', condition: '一局内满足全部 3 个 NPC 的隐性目标' },
  { id: 'tyrant', name: '暴君', icon: '👊', condition: '只用阿强完成一次通关' },
  { id: 'perfect_scholar', name: '完人', icon: '🧠', condition: '三人各至少执行一次行动并通关' },
  { id: 'gambler', name: '赌徒', icon: '🎲', condition: '只用 1 条神谕通关' },
  { id: 'last_stand', name: '绝境求生', icon: '⚡', condition: '最后 10 秒才下达第一条神谕并通关' },
  { id: 'survivor', name: '命悬一线', icon: '💀', condition: '饱食度低于 10 时通关' },
  { id: 'poet', name: '诗圣', icon: '📜', condition: '单局获得至少 1 次"神谕"品质评价' },
]

/** Fixed map landmarks — must stay in sync with GameScene & server system prompt. */
export const MAP_LANDMARKS = {
  forest: { label: '古松森林', x: 600, y: 150, emoji: '🌲' },
  library: { label: '岭南书斋', x: 160, y: 360, emoji: '📚' },
  camp: { label: '竹榻营地', x: 400, y: 540, emoji: '💤' },
} as const
