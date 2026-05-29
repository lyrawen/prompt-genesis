/* Shared sanitization and DeepSeek helpers for Vercel serverless functions. */

const VALID_NPC_NAMES = new Set(['阿强', '阿珍', '阿衰'])
const VALID_ACTIONS = new Set(['WALK_TO', 'PLAY_ANIMATION', 'SPEAK', 'IDLE'])
const VALID_ANIMATIONS = new Set(['CHOP', 'READ', 'SLEEP', 'IDLE'])
const VALID_WORLD_EVENTS = new Set(['STORM', 'FLOOD_SURGE', 'WILD_BOAR', 'SUPPLY_CACHE', 'RAIN', 'MOONLIGHT', 'DROUGHT', 'FIND_SUPPLIES'])
const VALID_RATINGS = new Set(['普通', '优秀', '神谕'])
const VALID_RESOURCES = new Set(['wood', 'knowledge', 'hunger'])
const VALID_MAP_MUTATIONS = new Set(['GROW_TREE', 'CHOP_TREE', 'BUILD', 'BURN', 'REPAIR'])
const VALID_MAP_TARGETS = new Set(['forest', 'library', 'camp', 'grass'])
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const REQUEST_TIMEOUT_MS = 45_000
const MAX_RETRIES = 2

/* ── JSON body parser ─────────────────────────────────── */

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch { reject(new Error('invalid json')) }
    })
    req.on('error', reject)
  })
}

/* ── Response helpers ─────────────────────────────────── */

export function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
}

/* ── Sanitization ─────────────────────────────────────── */

function stripMarkdownJson(raw) {
  let text = raw.trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) text = fenced[1].trim()
  return text
}

function sanitizeCommands(commands) {
  if (!Array.isArray(commands)) return []
  return commands
    .filter((cmd) => cmd && typeof cmd === 'object')
    .map((cmd) => {
      const npcName = VALID_NPC_NAMES.has(cmd.npcName) ? cmd.npcName : '阿衰'
      const action = VALID_ACTIONS.has(cmd.action) ? cmd.action : 'IDLE'
      const sanitized = { npcName, action }
      if (typeof cmd.targetX === 'number') sanitized.targetX = cmd.targetX
      if (typeof cmd.targetY === 'number') sanitized.targetY = cmd.targetY
      if (VALID_ANIMATIONS.has(cmd.animationType)) sanitized.animationType = cmd.animationType
      if (typeof cmd.bubbleText === 'string') sanitized.bubbleText = cmd.bubbleText.slice(0, 80)
      return sanitized
    })
}

function sanitizeStateImpact(impact) {
  const fallback = { woodDelta: 0, knowledgeDelta: 0, hungerDelta: -5 }
  if (!impact || typeof impact !== 'object') return fallback
  return {
    woodDelta: Number.isFinite(Number(impact.woodDelta)) ? Number(impact.woodDelta) : 0,
    knowledgeDelta: Number.isFinite(Number(impact.knowledgeDelta)) ? Number(impact.knowledgeDelta) : 0,
    hungerDelta: Number.isFinite(Number(impact.hungerDelta)) ? Number(impact.hungerDelta) : -5,
  }
}

function sanitizeWorldEvent(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  if (typeof raw.type !== 'string' || !VALID_WORLD_EVENTS.has(raw.type)) return undefined
  if (typeof raw.narrative !== 'string' || raw.narrative.length === 0) return undefined
  return { type: raw.type, narrative: raw.narrative.slice(0, 120), stateImpact: sanitizeStateImpact(raw.stateImpact) }
}

function sanitizeQuality(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  if (typeof raw.rating !== 'string' || !VALID_RATINGS.has(raw.rating)) return undefined
  return { rating: raw.rating, comment: typeof raw.comment === 'string' ? raw.comment.slice(0, 60) : undefined }
}

function sanitizeAfterShock(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  if (typeof raw.delayMs !== 'number' || raw.delayMs < 2000 || raw.delayMs > 10000) return undefined
  if (!raw.worldEvent || typeof raw.worldEvent !== 'object') return undefined
  const event = sanitizeWorldEvent(raw.worldEvent)
  if (!event) return undefined
  return { delayMs: raw.delayMs, worldEvent: event }
}

function sanitizeTrade(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  if (!VALID_RESOURCES.has(raw.from) || !VALID_RESOURCES.has(raw.to)) return undefined
  if (typeof raw.fromAmount !== 'number' || typeof raw.toAmount !== 'number') return undefined
  if (raw.fromAmount <= 0 || raw.toAmount <= 0) return undefined
  if (typeof raw.narrative !== 'string' || raw.narrative.length === 0) return undefined
  return { from: raw.from, to: raw.to, fromAmount: raw.fromAmount, toAmount: raw.toAmount, narrative: raw.narrative.slice(0, 80) }
}

function sanitizeMapMutation(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  if (typeof raw.type !== 'string' || !VALID_MAP_MUTATIONS.has(raw.type)) return undefined
  if (typeof raw.target !== 'string' || !VALID_MAP_TARGETS.has(raw.target)) return undefined
  if (typeof raw.description !== 'string' || raw.description.length === 0) return undefined
  return { type: raw.type, target: raw.target, description: raw.description.slice(0, 80) }
}

function sanitizeLLMResponse(raw) {
  let parsed
  try {
    parsed = typeof raw === 'string' ? JSON.parse(stripMarkdownJson(raw)) : raw
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  return {
    eventName: typeof parsed.eventName === 'string' ? parsed.eventName : 'divine_command',
    commands: sanitizeCommands(parsed.commands),
    stateImpact: sanitizeStateImpact(parsed.stateImpact),
    worldEvent: sanitizeWorldEvent(parsed.worldEvent),
    quality: sanitizeQuality(parsed.quality),
    afterShock: sanitizeAfterShock(parsed.afterShock),
    trade: sanitizeTrade(parsed.trade),
    mapMutation: sanitizeMapMutation(parsed.mapMutation),
  }
}

/* ── DeepSeek helper ──────────────────────────────────── */

function isNetworkError(error) {
  if (!error || typeof error !== 'object') return false
  const code = error.cause?.code ?? error.code
  return error.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || error.message === 'fetch failed'
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

const SYSTEM_PROMPT = `你是一个 2D 沙盒游戏《Prompt创世纪》的后台神明意志解析引擎。
当前场景包含 3 个 NPC：
1. 阿强 (力量型，擅长砍树伐木) — 砍树效率×2，读书效率×0.5
2. 阿珍 (学者型，擅长读书研究) — 读书效率×2，砍树效率×0.5
3. 阿衰 (恢复型，擅长在竹榻睡觉恢复体力) — 睡觉时hungerDelta恢复效果×2，干活饱食消耗×1.5

游戏地图固定资源坐标（像素位置）为：
- 🌲 古松森林: [600, 150] (如果让阿强去砍树，请分发 WALK_TO 且目的地为此坐标)
- 📚 岭南书斋: [160, 360] (如果让阿珍去读书，请分发 WALK_TO 且目的地为此坐标)
- 💤 竹榻营地: [400, 540] (如果让阿衰去躺平/休息，请分发 WALK_TO 且目的地为此坐标)

玩家会输入任意的"神谕指令"（自然语言）。你的任务是：
1. 理解玩家意图，合理拆解为这三个 NPC 的行动队列，并科学演算本次行动对全局资源的影响。
2. **可选的叙事事件**：你可以根据玩家神谕的内容，在响应中附带一个 worldEvent 字段。
3. **神谕品质评分**：请根据玩家输入的质量给出 quality 评分。
4. 必须且只能输出符合以下 TypeScript 接口的纯 JSON 对象。绝对不能包含任何多余的解释、不要 Markdown 标记。
5. **连锁事件（可选）**：可以根据神谕生成 afterShock 字段。
6. **资源兑换（可选）**：可以根据神谕内容附带 trade 字段。
7. **地图变化（可选）**：可以根据神谕内容附带 mapMutation 字段。

接口结构请参考 server/divineApi.js 中的定义。`

export async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null

  let lastError
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const upstream = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      return upstream
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRIES && isNetworkError(error)) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      throw error
    }
  }
  throw lastError
}

export async function callDeepSeekRaw(messages, temperature = 0.8, maxTokens = 300, timeoutMs = 15000) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null
  try {
    const upstream = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages, temperature, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!upstream.ok) return null
    const payload = await upstream.json()
    return payload?.choices?.[0]?.message?.content?.trim() ?? null
  } catch { return null }
}

export { sanitizeLLMResponse, sanitizeStateImpact, sanitizeCommands, sanitizeWorldEvent, sanitizeAfterShock, sanitizeTrade, sanitizeMapMutation, sanitizeQuality, stripMarkdownJson }
