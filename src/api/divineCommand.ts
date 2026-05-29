import type {
  AfterShock,
  AnimationType,
  EpilogueRequest,
  LLMResponse,
  MapMutation,
  MapMutationType,
  MapTarget,
  NPCAction,
  NPCCommand,
  NPCName,
  QualityFeedback,
  QualityRating,
  ResourceTrade,
  StateImpact,
  WorldEvent,
  WorldEventType,
} from '../types'

const VALID_NPC_NAMES = new Set<NPCName>(['阿强', '阿珍', '阿衰'])
const VALID_ACTIONS = new Set<NPCAction>(['WALK_TO', 'PLAY_ANIMATION', 'SPEAK', 'IDLE'])
const VALID_ANIMATIONS = new Set<AnimationType>(['CHOP', 'READ', 'SLEEP', 'IDLE'])
const VALID_WORLD_EVENTS = new Set<WorldEventType>([
  'STORM', 'FLOOD_SURGE', 'WILD_BOAR', 'SUPPLY_CACHE', 'RAIN', 'MOONLIGHT', 'DROUGHT', 'FIND_SUPPLIES',
])
const VALID_RATINGS = new Set<QualityRating>(['普通', '优秀', '神谕'])
const VALID_RESOURCES = new Set(['wood', 'knowledge', 'hunger'])
const VALID_MAP_MUTATIONS = new Set<MapMutationType>(['GROW_TREE', 'CHOP_TREE', 'BUILD', 'BURN', 'REPAIR'])
const VALID_MAP_TARGETS = new Set<MapTarget>(['forest', 'library', 'camp', 'grass'])

const FALLBACK_RESPONSE: LLMResponse = {
  eventName: 'hallucination_guard',
  commands: [{ npcName: '阿衰', action: 'IDLE', bubbleText: '神谕无法解析，原地待机。' }],
  stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: -2 },
}

function sanitizeCommand(raw: unknown): NPCCommand | null {
  if (!raw || typeof raw !== 'object') return null

  const cmd = raw as Record<string, unknown>
  const npcName = VALID_NPC_NAMES.has(cmd.npcName as NPCName) ? (cmd.npcName as NPCName) : null
  const action = VALID_ACTIONS.has(cmd.action as NPCAction) ? (cmd.action as NPCAction) : 'IDLE'

  if (!npcName) return null

  const sanitized: NPCCommand = { npcName, action }

  if (typeof cmd.targetX === 'number') sanitized.targetX = cmd.targetX
  if (typeof cmd.targetY === 'number') sanitized.targetY = cmd.targetY
  if (VALID_ANIMATIONS.has(cmd.animationType as AnimationType)) {
    sanitized.animationType = cmd.animationType as AnimationType
  }
  if (typeof cmd.bubbleText === 'string') sanitized.bubbleText = cmd.bubbleText.slice(0, 80)

  return sanitized
}

function sanitizeStateImpact(raw: unknown): StateImpact {
  if (!raw || typeof raw !== 'object') {
    return { ...FALLBACK_RESPONSE.stateImpact }
  }

  const impact = raw as Record<string, unknown>
  return {
    woodDelta: Number.isFinite(Number(impact.woodDelta)) ? Number(impact.woodDelta) : 0,
    knowledgeDelta: Number.isFinite(Number(impact.knowledgeDelta)) ? Number(impact.knowledgeDelta) : 0,
    hungerDelta: Number.isFinite(Number(impact.hungerDelta)) ? Number(impact.hungerDelta) : -5,
  }
}

function sanitizeWorldEvent(raw: unknown): WorldEvent | undefined {
  if (!raw || typeof raw !== 'object') return undefined

  const ev = raw as Record<string, unknown>
  if (typeof ev.type !== 'string' || !VALID_WORLD_EVENTS.has(ev.type as WorldEventType)) {
    return undefined
  }
  if (typeof ev.narrative !== 'string' || ev.narrative.length === 0) return undefined

  return {
    type: ev.type as WorldEventType,
    narrative: ev.narrative.slice(0, 120),
    stateImpact: sanitizeStateImpact(ev.stateImpact),
  }
}

function sanitizeQuality(raw: unknown): QualityFeedback | undefined {
  if (!raw || typeof raw !== 'object') return undefined

  const q = raw as Record<string, unknown>
  if (typeof q.rating !== 'string' || !VALID_RATINGS.has(q.rating as QualityRating)) {
    return undefined
  }

  return {
    rating: q.rating as QualityRating,
    comment: typeof q.comment === 'string' ? q.comment.slice(0, 60) : undefined,
  }
}

function sanitizeAfterShock(raw: unknown): AfterShock | undefined {
  if (!raw || typeof raw !== 'object') return undefined

  const as = raw as Record<string, unknown>
  if (typeof as.delayMs !== 'number' || as.delayMs < 2000 || as.delayMs > 10000) return undefined
  const worldEvent = sanitizeWorldEvent(as.worldEvent)
  if (!worldEvent) return undefined

  return { delayMs: as.delayMs, worldEvent }
}

function sanitizeTrade(raw: unknown): ResourceTrade | undefined {
  if (!raw || typeof raw !== 'object') return undefined

  const t = raw as Record<string, unknown>
  if (typeof t.from !== 'string' || typeof t.to !== 'string') return undefined
  if (!VALID_RESOURCES.has(t.from) || !VALID_RESOURCES.has(t.to)) return undefined
  if (typeof t.fromAmount !== 'number' || typeof t.toAmount !== 'number') return undefined
  if (t.fromAmount <= 0 || t.toAmount <= 0) return undefined
  if (typeof t.narrative !== 'string' || t.narrative.length === 0) return undefined

  return { from: t.from as ResourceTrade['from'], to: t.to as ResourceTrade['to'], fromAmount: t.fromAmount, toAmount: t.toAmount, narrative: t.narrative.slice(0, 80) }
}

function sanitizeMapMutation(raw: unknown): MapMutation | undefined {
  if (!raw || typeof raw !== 'object') return undefined

  const m = raw as Record<string, unknown>
  if (typeof m.type !== 'string' || !VALID_MAP_MUTATIONS.has(m.type as MapMutationType)) return undefined
  if (typeof m.target !== 'string' || !VALID_MAP_TARGETS.has(m.target as MapTarget)) return undefined
  if (typeof m.description !== 'string' || m.description.length === 0) return undefined

  return { type: m.type as MapMutationType, target: m.target as MapTarget, description: m.description.slice(0, 80) }
}

/** Anti-hallucination guardrail — downgrade invalid LLM output to safe IDLE. */
export function parseLLMResponse(raw: unknown): LLMResponse {
  try {
    if (!raw || typeof raw !== 'object') return { ...FALLBACK_RESPONSE }

    const payload = raw as Record<string, unknown>
    const commands = Array.isArray(payload.commands)
      ? payload.commands.map(sanitizeCommand).filter((cmd): cmd is NPCCommand => cmd !== null)
      : []

    return {
      eventName: typeof payload.eventName === 'string' ? payload.eventName : 'divine_command',
      commands: commands.length > 0 ? commands : [...FALLBACK_RESPONSE.commands],
      stateImpact: sanitizeStateImpact(payload.stateImpact),
      worldEvent: sanitizeWorldEvent(payload.worldEvent),
      quality: sanitizeQuality(payload.quality),
      afterShock: sanitizeAfterShock(payload.afterShock),
      trade: sanitizeTrade(payload.trade),
      mapMutation: sanitizeMapMutation(payload.mapMutation),
    }
  } catch {
    return { ...FALLBACK_RESPONSE }
  }
}

export async function fetchEpilogue(data: EpilogueRequest): Promise<string> {
  try {
    const res = await fetch('/api/generate-epilogue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`epilogue API ${res.status}`)
    const json: { narrative: string } = await res.json()
    return json.narrative
  } catch {
    return ''
  }
}

export async function fetchIdleEvent(ctx: { timeLeft?: number; wood?: number; knowledge?: number; hunger?: number }): Promise<string> {
  try {
    const res = await fetch('/api/generate-idle-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx),
    })
    if (!res.ok) return ''
    const json: { narrative: string } = await res.json()
    return json.narrative
  } catch {
    return ''
  }
}

export async function fetchDivineCommand(prompt: string, npcState?: Record<string, unknown>, history?: string[]): Promise<LLMResponse> {
  const response = await fetch('/api/divine-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, npcState, history }),
  })

  if (!response.ok) {
    let detail = await response.text()
    try {
      const parsed = JSON.parse(detail) as { error?: string; detail?: string }
      detail = parsed.error ?? detail
      if (parsed.detail) detail += ` (${parsed.detail})`
    } catch {
      // keep raw text
    }
    throw new Error(`API ${response.status}: ${detail}`)
  }

  const json: unknown = await response.json()
  return parseLLMResponse(json)
}
