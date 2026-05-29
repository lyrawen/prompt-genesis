import 'dotenv/config'
import express from 'express'
import { mockInterpretPrompt, generateMockEpilogue } from './mockFallback.js'

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const REQUEST_TIMEOUT_MS = 45_000
const MAX_RETRIES = 2
const USE_OFFLINE_FALLBACK = process.env.USE_OFFLINE_FALLBACK !== 'false'

const SYSTEM_PROMPT = `你是一个 2D 沙盒游戏《Prompt创世纪》的后台神明意志解析引擎。
当前场景包含 3 个 NPC：
1. 阿强 (力量型，擅长砍树伐木) — 砍树效率×2，读书效率×0.5
2. 阿珍 (学者型，擅长读书研究) — 读书效率×2，砍树效率×0.5
3. 阿衰 (恢复型，擅长在竹榻睡觉恢复体力) — 睡觉时hungerDelta恢复效果×2，干活饱食消耗×1.5

游戏地图固定资源坐标（像素位置）为：
- 🌲 古松森林: [600, 150] (如果让阿强去砍树，请分发 WALK_TO 且目的地为此坐标)
- 📚 岭南书斋: [160, 360] (如果让阿珍去读书，请分发 WALK_TO 且目的地为此坐标)
- 💤 竹榻营地: [400, 540] (如果让阿衰去躺平/休息，请分发 WALK_TO 且目的地为此坐标)

玩家会输入任意的”神谕指令”（自然语言）。你的任务是：
1. 理解玩家意图，合理拆解为这三个 NPC 的行动队列，并科学演算本次行动对全局资源（woodDelta, knowledgeDelta, hungerDelta）的影响。如果是符合他们特长的行为（如阿强砍树），资源增加更多，但任何行动都会消耗一定饱食度（hungerDelta 为负数）。如果让他们去休息（如阿衰躺平），hungerDelta 可以为正（恢复饱食度）。
2. **可选的叙事事件**：你可以根据玩家神谕的内容，在响应中附带一个 worldEvent 字段来生成环境事件，例如风暴、洪水突袭、野猪入侵、补给发现、月夜、旱灾等。这会让游戏世界更有沉浸感。如果不适合当前神谕，就不要生成。
3. **神谕品质评分**：请根据玩家输入的”神谕”质量，给出一个 quality 评分：
   - “神谕”：玩家输入具有画面感、叙事张力、贴合世界观（如”风暴将至，拿起斧头，翻开书卷”），资源产出×1.5，饱食消耗减半
   - “优秀”：玩家输入清晰合理、有创意但不是特别有画面感，资源产出×1.2
   - “普通”：玩家输入只是简单的指令（如”砍树读书睡觉”），按标准值计算
   - 注意：乱码/纯字母/无意义输入 不附 quality 字段
4. 必须且只能输出符合以下 TypeScript 接口的纯 JSON 对象。绝对不能包含任何多余的解释、不要 Markdown 标记（严禁使用 \`\`\`json 包裹）。

接口结构：
{
  “eventName”: string,
  “commands”: [
    {
      “npcName”: “阿强” | “阿珍” | “阿衰”,
      “action”: “WALK_TO” | “PLAY_ANIMATION” | “SPEAK” | “IDLE”,
      “targetX”: number (optional),
      “targetY”: number (optional),
      “animationType”: “CHOP” | “READ” | “SLEEP” | “IDLE” (optional),
      “bubbleText”: string (optional)
    }
  ],
  “stateImpact”: {
    “woodDelta”: number,
    “knowledgeDelta”: number,
    “hungerDelta”: number
  },
  “worldEvent”: {
    “type”: “STORM” | “FLOOD_SURGE” | “WILD_BOAR” | “SUPPLY_CACHE” | “RAIN” | “MOONLIGHT” | “DROUGHT” | “FIND_SUPPLIES”,
    “narrative”: string,
    “stateImpact”: { “woodDelta”: number, “knowledgeDelta”: number, “hungerDelta”: number }
  },
  “quality”: {
    “rating”: “普通” | “优秀” | “神谕”,
    “comment”: string (optional, 简短评价，不超过20字)
  },
  “trade”: {
    “from”: “wood” | “knowledge” | “hunger”,
    “to”: “wood” | “knowledge” | “hunger”,
    “fromAmount”: number,
    “toAmount”: number,
    “narrative”: string
  },
  “mapMutation”: {
    “type”: “GROW_TREE” | “CHOP_TREE” | “BUILD” | “BURN” | “REPAIR”,
    “target”: “forest” | “library” | “camp” | “grass”,
    “description”: string
  }
}

animationType 对应关系：阿强砍树用 CHOP，阿珍读书用 READ，阿衰休息用 SLEEP。
worldEvent 和 quality 是可选字段，不生成时请省略整个字段。
如果玩家的神谕让你联想到某种环境变化或突发事件，就生成一个 worldEvent，让游戏更有戏剧性。
5. **连锁事件（可选）**：你可以根据本条神谕的内容，生成一个 afterShock 字段，代表"神谕的余震"——5 秒后触发的第二个世界事件，且应与本条神谕语义相关且不影响游戏资源（stateImpact 为 0）。
例如：神谕提到"砍树"→ 余震可以是"树木倒下惊动了野猪"（WILD_BOAR）
例如：神谕提到"读书"→ 余震可以是"从书卷中发现了一张古代地图"（FIND_SUPPLIES）
afterShock 的 delayMs 固定为 5000。
注意：不是每次神谕都需要余震。只有当你觉得这条神谕"值得一个回响"时才生成。
6. **资源兑换（可选）**：如果神谕内容暗示了资源转换（如"把木材用来建书架"暗示木材→知识），可以在响应中附带一个 trade 字段，但注意不要影响 stateImpact 的数值（stateImpact 仍计算行动本身的资源变化，trade 表示额外的转换操作）。
7. **地图变化（可选）**：如果神谕内容暗示了世界的变化（如"点起篝火"、"把树砍了"、"修缮书斋"），可以在响应中附带一个 mapMutation 字段，描述地图上的视觉变化。mapMutation 不影响资源数值（资源影响通过 stateImpact 计算），纯粹是世界观层面的变化。
   - GROW_TREE：在草地某处长出一棵新树（视觉）
   - CHOP_TREE：一棵树被砍倒（视觉）
   - BUILD：新建一个小型建筑（篝火/木堆等）
   - BURN：某处发生燃烧
   - REPAIR：某处被修缮
   target 可以是 forest, library, camp, grass 之一。`

const VALID_NPC_NAMES = new Set(['阿强', '阿珍', '阿衰'])
const VALID_ACTIONS = new Set(['WALK_TO', 'PLAY_ANIMATION', 'SPEAK', 'IDLE'])
const VALID_ANIMATIONS = new Set(['CHOP', 'READ', 'SLEEP', 'IDLE'])
const VALID_WORLD_EVENTS = new Set(['STORM', 'FLOOD_SURGE', 'WILD_BOAR', 'SUPPLY_CACHE', 'RAIN', 'MOONLIGHT', 'DROUGHT', 'FIND_SUPPLIES'])
const VALID_RATINGS = new Set(['普通', '优秀', '神谕'])

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

  return {
    type: raw.type,
    narrative: raw.narrative.slice(0, 120),
    stateImpact: sanitizeStateImpact(raw.stateImpact),
  }
}

function sanitizeQuality(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  if (typeof raw.rating !== 'string' || !VALID_RATINGS.has(raw.rating)) return undefined
  return {
    rating: raw.rating,
    comment: typeof raw.comment === 'string' ? raw.comment.slice(0, 60) : undefined,
  }
}

function sanitizeAfterShock(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  if (typeof raw.delayMs !== 'number' || raw.delayMs < 2000 || raw.delayMs > 10000) return undefined
  if (!raw.worldEvent || typeof raw.worldEvent !== 'object') return undefined
  const event = sanitizeWorldEvent(raw.worldEvent)
  if (!event) return undefined
  return { delayMs: raw.delayMs, worldEvent: event }
}

const VALID_RESOURCES = new Set(['wood', 'knowledge', 'hunger'])
const VALID_MAP_MUTATIONS = new Set(['GROW_TREE', 'CHOP_TREE', 'BUILD', 'BURN', 'REPAIR'])
const VALID_MAP_TARGETS = new Set(['forest', 'library', 'camp', 'grass'])

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
    return fallbackResponse('json_parse_error')
  }

  if (!parsed || typeof parsed !== 'object') return fallbackResponse('not_an_object')

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

function fallbackResponse(reason) {
  return {
    eventName: 'hallucination_guard',
    commands: [{ npcName: '阿衰', action: 'IDLE', bubbleText: '神谕模糊，我先躺为敬…' }],
    stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: -2 },
    _meta: { reason },
  }
}

function isNetworkError(error) {
  if (!error || typeof error !== 'object') return false
  const code = error.cause?.code ?? error.code
  return (
    error.name === 'TimeoutError' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    error.message === 'fetch failed'
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callDeepSeek(prompt) {
  let lastError

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const upstream = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      return upstream
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRIES && isNetworkError(error)) {
        console.warn(`[DeepSeek] attempt ${attempt + 1} failed, retrying…`, error.cause?.code ?? error.message)
        await sleep(1500 * (attempt + 1))
        continue
      }
      throw error
    }
  }

  throw lastError
}

/** Shared Express router — mounted by Vite dev plugin and standalone server.js */
export function createDivineApiRouter() {
  const router = express.Router()
  router.use(express.json({ limit: '16kb' }))

  router.get('/health', async (_req, res) => {
    let deepseekReachable = false
    try {
      const probe = await fetch(DEEPSEEK_BASE_URL, {
        method: 'GET',
        signal: AbortSignal.timeout(8000),
      })
      deepseekReachable = probe.status < 500
    } catch {
      deepseekReachable = false
    }

    res.json({
      ok: true,
      hasApiKey: Boolean(DEEPSEEK_API_KEY),
      deepseekReachable,
      offlineFallbackEnabled: USE_OFFLINE_FALLBACK,
    })
  })

  router.post('/divine-command', async (req, res) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' })
    }

    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({ error: 'DEEPSEEK_API_KEY is not configured in .env' })
    }

    // Inject NPC personality state & conversation history
    const npcState = req.body?.npcState
    const history = req.body?.history
    let contextualPrompt = prompt
    if (history && history.length > 0) {
      contextualPrompt = `（最近神谕记录：${history.join(' → ')}）\n${prompt}`
    }
    // Inject world state & relationships
    if (npcState?.worldState) {
      contextualPrompt += `\n\n（世界状态：${npcState.worldState}。请注意这个世界的变化。）`
    }
    if (npcState?.relationships) {
      contextualPrompt += `\n（NPC关系：${npcState.relationships}。正数代表友好，负数代表紧张。请让友好的NPC一起工作以获得更好的配合。）`
    }

    // Inject custom NPC names for narrative only (NOT for command npcName field)
    const nameNote = []
    for (const n of ['阿强', '阿珍',  '阿衰']) {
      const custom = npcState?.[n]?.customName
      if (custom && custom !== n) nameNote.push(`${n}（玩家将其命名为"${custom}"）`)
    }
    if (nameNote.length > 0) contextualPrompt += `\n\n（注：${nameNote.join('；')}——请在 SPEAK 气泡文本中使用这些自定义名称，但命令中的 npcName 必须使用原始名称：阿强、阿珍、阿衰）`

    if (npcState && npcState.阿衰) {
      const slacker = npcState.阿衰
      if (slacker.resistance > 30) {
        contextualPrompt += `\n\n（注：阿衰当前抵触值 ${slacker.resistance}/100，不太情愿干活，请尽量避免分配重体力任务给他。）`
      }
    }

    try {
      const upstream = await callDeepSeek(contextualPrompt)

      if (!upstream.ok) {
        const errText = await upstream.text()
        console.error('[DeepSeek]', upstream.status, errText)

        if (upstream.status === 401 || upstream.status === 403) {
          return res.status(502).json({
            error: 'DeepSeek API 密钥无效或已过期，请检查 .env 中的 DEEPSEEK_API_KEY',
            detail: errText,
          })
        }

        return res.status(502).json({ error: 'DeepSeek API request failed', detail: errText })
      }

      const payload = await upstream.json()
      const content = payload?.choices?.[0]?.message?.content

      if (!content) {
        return res.json(fallbackResponse('empty_model_content'))
      }

      try {
        const sanitized = sanitizeLLMResponse(content)
        if (sanitized.commands.length === 0) {
          sanitized.commands = [{ npcName: '阿衰', action: 'IDLE' }]
        }
        return res.json(sanitized)
      } catch (parseError) {
        console.error('[Parse]', parseError)
        return res.json(fallbackResponse('json_parse_failed'))
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        if (USE_OFFLINE_FALLBACK) {
          console.warn('[Server] DeepSeek timed out — using offline fallback')
          const offline = mockInterpretPrompt(prompt, npcState, history)
          return res.json({ ...offline, _meta: { fallback: true, reason: 'timeout' } })
        }
        return res.status(504).json({ error: 'DeepSeek API 请求超时，请检查网络后重试' })
      }

      if (isNetworkError(error)) {
        console.error('[Server] Network error:', error.cause?.code ?? error.message)
        if (USE_OFFLINE_FALLBACK) {
          console.warn('[Server] DeepSeek unreachable — using offline fallback')
          const offline = mockInterpretPrompt(prompt, npcState, history)
          return res.json({
            ...offline,
            _meta: { fallback: true, reason: error.cause?.code ?? error.message },
          })
        }
        return res.status(503).json({
          error: '无法连接 DeepSeek API（网络超时），请检查网络或代理设置',
          detail: error.cause?.code ?? error.message,
        })
      }

      console.error('[Server]', error)
      return res.status(500).json({
        error: 'Internal server error',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  })

  router.post('/generate-epilogue', async (req, res) => {
    const body = req.body
    if (!body || !body.outcome) {
      return res.status(400).json({ error: 'outcome is required' })
    }

    // If DeepSeek is not configured, return mock epilogue
    if (!DEEPSEEK_API_KEY) {
      return res.json({ narrative: buildMockEpilogue(body) })
    }

    const epiloguePrompt = `你是《Prompt创世纪》的史官。以下是一局游戏的最终状态，请用古风叙事风格写一段50-100字的结局旁白。

结局：${body.outcome === 'win' ? '文明延续（胜利）' : body.outcome === 'lose_hunger' ? '全员饿死' : '大洪水淹没一切'}
木材：${body.wood}，知识：${body.knowledge}，饱食度：${body.hunger}
共降下神谕 ${body.promptsCast} 次。

神谕记录：
${(body.history || []).map((h, i) => `第${i + 1}谕：${h.prompt}${h.quality ? `（品质：${h.quality.rating}）` : ''}${h.worldEvent ? `→ 触发事件：${h.worldEvent.type}` : ''}`).join('\n')}

请以第三人称、古风文风，写一段富有画面感的结局旁白。只输出叙事文本，不要解释。`

    try {
      const upstream = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是一个写古风叙事文本的AI。只输出叙事文本，不要有任何额外说明。' },
            { role: 'user', content: epiloguePrompt },
          ],
          temperature: 0.8,
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (!upstream.ok) {
        return res.json({ narrative: buildMockEpilogue(body) })
      }

      const payload = await upstream.json()
      const narrative = payload?.choices?.[0]?.message?.content?.trim()
      return res.json({ narrative: narrative || buildMockEpilogue(body) })
    } catch {
      return res.json({ narrative: buildMockEpilogue(body) })
    }
  })

  router.post('/generate-idle-event', async (req, res) => {
    const { timeLeft, wood, knowledge, hunger } = req.body || {}

    if (!DEEPSEEK_API_KEY) {
      return res.json({ narrative: pickIdleNarrative({ timeLeft, wood, knowledge, hunger }) })
    }

    const idlePrompt = `你是《Prompt创世纪》的世界低语者。游戏正在进行中（倒计时 ${timeLeft ?? '?'} 秒，木材 ${wood ?? 0}，知识 ${knowledge ?? 0}，饱食度 ${hunger ?? 0}）。请用 15-30 字写一句古风氛围描写，描述这个世界此刻的模样。只输出叙事文本，不要解释。`

    try {
      const upstream = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是一个写古风氛围描写的AI。只输出一句叙事文本。' },
            { role: 'user', content: idlePrompt },
          ],
          temperature: 0.9,
          max_tokens: 100,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!upstream.ok) return res.json({ narrative: pickIdleNarrative(req.body) })
      const payload = await upstream.json()
      const narrative = payload?.choices?.[0]?.message?.content?.trim()
      return res.json({ narrative: narrative || pickIdleNarrative(req.body) })
    } catch {
      return res.json({ narrative: pickIdleNarrative(req.body) })
    }
  })

  return router
}

function pickIdleNarrative(state) {
  const { timeLeft, wood, knowledge, hunger } = state || {}
  if (hunger !== undefined && hunger <= 20) {
    const famine = [
      '饥饿像潮水般蔓延，信徒们的脚步越来越沉重了。',
      '空空的胃在低鸣，古松林的树皮也快被啃光了。',
      '每个人都在节省体力——连呼吸都变得小心翼翼。',
    ]
    return famine[Math.floor(Math.random() * famine.length)]
  }
  if (timeLeft !== undefined && timeLeft <= 15) {
    return '水声越来越近了。空气中弥漫着一股潮湿的土腥味。'
  }
  const pool = [
    '风吹过古松林，针叶发出细碎的私语。',
    '竹榻在微风中轻轻摇晃，发出吱呀的声响。',
    '书斋的窗纸透出暖黄的光，在暮色中摇曳。',
    '青花水墨般的水面泛起涟漪，一片寂静。',
    '远处传来一声鸟鸣，很快被风声吞没。',
    '岭南书斋的香炉升起一缕青烟，盘旋不散。',
    '宣纸般的草地上，露珠在夕阳下闪闪发光。',
    '阿衰翻了个身，竹榻又响了一声。',
    '古松的影子在地面上缓缓移动，时光流逝。',
    '一阵寒意从水面袭来，让人打了个寒颤。',
  ]
  return pool[Math.floor(Math.random() * pool.length)]
}

function buildMockEpilogue(body) {
  return generateMockEpilogue(body)
}

export function logApiStatus() {
  console.log(`[Prompt Genesis] DeepSeek key loaded: ${DEEPSEEK_API_KEY ? 'yes' : 'NO — check .env'}`)
}

/* Exported for testing */
export function _testOnly() {
  return { sanitizeLLMResponse, sanitizeStateImpact, sanitizeCommands, sanitizeWorldEvent, sanitizeAfterShock, sanitizeMapMutation, stripMarkdownJson, pickIdleNarrative }
}
