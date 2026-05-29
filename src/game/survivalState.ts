import type { GlobalGameState, StateImpact } from '../types'

export const WIN_WOOD = 3
export const WIN_KNOWLEDGE = 3
export const INITIAL_TIME = 60
export const BASE_HUNGER = 100
const BASE_DRAIN = 2

export interface DifficultyConfig {
  initialHunger: number
  drainRate: number
  needWood: number
  needKnowledge: number
}

export interface ChallengeConfig {
  id: string
  name: string
  description: string
  maxPrompts?: number
  winKnowledge?: number
  initialTime?: number
  drainRate?: number
  woodRequired?: number
}

export const CHALLENGES: ChallengeConfig[] = [
  { id: 'none', name: '标准模式', description: '常规 60 秒生存', initialTime: 60 },
  { id: 'silent_storm', name: '禁言风暴', description: '只能下达 2 条神谕', maxPrompts: 2 },
  { id: 'knowledge_first', name: '知识至上', description: '知识 ≥5 才胜利，木材不计', winKnowledge: 5, woodRequired: 0 },
  { id: 'hell_30s', name: '30 秒地狱', description: '倒计时 30s，饱食度衰减翻倍', initialTime: 30, drainRate: 4 },
]

export function createDifficultyConfig(level: number): DifficultyConfig {
  return {
    initialHunger: Math.max(60, BASE_HUNGER - level * 10),
    drainRate: Math.min(5, BASE_DRAIN + level * 0.5),
    needWood: Math.min(6, WIN_WOOD + Math.floor(level / 2)),
    needKnowledge: Math.min(6, WIN_KNOWLEDGE + Math.floor(level / 2)),
  }
}

export function createInitialGameState(difficulty?: DifficultyConfig, challenge?: ChallengeConfig): GlobalGameState {
  return {
    wood: 0,
    knowledge: 0,
    hunger: difficulty?.initialHunger ?? BASE_HUNGER,
    timeLeft: challenge?.initialTime ?? INITIAL_TIME,
    isGameOver: false,
  }
}

export function applyStateImpact(state: GlobalGameState, impact: StateImpact): GlobalGameState {
  return {
    ...state,
    wood: Math.max(0, state.wood + impact.woodDelta),
    knowledge: Math.max(0, state.knowledge + impact.knowledgeDelta),
    hunger: clamp(state.hunger + impact.hungerDelta, 0, 100),
  }
}

export function tickSecond(
  state: GlobalGameState,
  elapsedSeconds: number,
  drainRate = BASE_DRAIN,
): GlobalGameState {
  if (state.isGameOver) return state

  const nextTime = state.timeLeft - 1
  const passiveHungerDrain = elapsedSeconds > 0 && elapsedSeconds % 5 === 0 ? drainRate : 0

  return {
    ...state,
    timeLeft: Math.max(0, nextTime),
    hunger: clamp(state.hunger - passiveHungerDrain, 0, 100),
  }
}

export type SettlementResult = 'playing' | 'win' | 'lose_timeout' | 'lose_hunger'

export function evaluateSettlement(state: GlobalGameState, difficulty?: DifficultyConfig, challenge?: ChallengeConfig): SettlementResult {
  if (state.isGameOver) return 'playing'

  if (state.hunger <= 0) return 'lose_hunger'
  if (state.timeLeft <= 0) {
    // Challenge overrides difficulty, difficulty overrides default
    const needWood = challenge?.woodRequired ?? difficulty?.needWood ?? WIN_WOOD
    const needKnowledge = challenge?.winKnowledge ?? difficulty?.needKnowledge ?? WIN_KNOWLEDGE
    return state.wood >= needWood && state.knowledge >= needKnowledge ? 'win' : 'lose_timeout'
  }

  return 'playing'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
