/**
 * Prompt Genesis — Vercel Serverless Function
 * Handles /api/* routes: divine-command, generate-epilogue, generate-idle-event, health
 */

import { parseBody, json, callDeepSeek, callDeepSeekRaw, sanitizeLLMResponse, sanitizeStateImpact, sanitizeWorldEvent, sanitizeQuality, sanitizeAfterShock, sanitizeTrade, sanitizeMapMutation } from './_shared.js'
import { mockInterpretPrompt, generateMockEpilogue } from '../server/mockFallback.js'

const USE_OFFLINE_FALLBACK = process.env.USE_OFFLINE_FALLBACK !== 'false'

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname.replace(/^\/api/, '') || '/'

  try {
    // GET /api/health
    if (req.method === 'GET' && path === '/health') {
      let deepseekReachable = false
      try {
        const probe = await fetch(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', { method: 'GET', signal: AbortSignal.timeout(8000) })
        deepseekReachable = probe.status < 500
      } catch { deepseekReachable = false }
      return json(res, { ok: true, hasApiKey: Boolean(process.env.DEEPSEEK_API_KEY), deepseekReachable, offlineFallbackEnabled: USE_OFFLINE_FALLBACK })
    }

    // All POST endpoints require body parsing
    if (req.method !== 'POST') return json(res, { error: 'method not allowed' }, 405)

    const body = await parseBody(req)

    // POST /api/divine-command
    if (path === '/divine-command') {
      const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
      if (!prompt) return json(res, { error: 'prompt is required' }, 400)

      const npcState = body?.npcState
      const history = body?.history
      let contextualPrompt = prompt
      if (history && history.length > 0) contextualPrompt = `（最近神谕记录：${history.join(' → ')}）\n${prompt}`
      if (npcState?.worldState) contextualPrompt += `\n\n（世界状态：${npcState.worldState}。）`
      if (npcState?.relationships) contextualPrompt += `\n（NPC关系：${npcState.relationships}。）`

      // Inject custom names
      const nameNote = []
      for (const n of ['阿强', '阿珍', '阿衰']) {
        const custom = npcState?.[n]?.customName
        if (custom && custom !== n) nameNote.push(`${n}（玩家将其命名为"${custom}"）`)
      }
      if (nameNote.length > 0) contextualPrompt += `\n\n（注：${nameNote.join('；')}）`
      if (npcState?.阿衰?.resistance > 30) contextualPrompt += `\n\n（注：阿衰当前抵触值 ${npcState.阿衰.resistance}/100，不太情愿干活。）`

      const apiKey = process.env.DEEPSEEK_API_KEY
      if (!apiKey) return json(res, { error: 'DEEPSEEK_API_KEY not configured' }, 500)

      try {
        const upstream = await callDeepSeek(contextualPrompt)
        if (!upstream || !upstream.ok) return json(res, { error: 'DeepSeek request failed' }, 502)

        const payload = await upstream.json()
        const content = payload?.choices?.[0]?.message?.content
        if (!content) return json(res, sanitizeLLMResponse(null) ?? { eventName: 'hallucination_guard', commands: [{ npcName: '阿衰', action: 'IDLE' }], stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: -2 } })

        let sanitized = sanitizeLLMResponse(content)
        if (!sanitized) sanitized = { eventName: 'hallucination_guard', commands: [{ npcName: '阿衰', action: 'IDLE', bubbleText: '神谕模糊，我先躺为敬…' }], stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: -2 } }
        if (sanitized.commands.length === 0) sanitized.commands = [{ npcName: '阿衰', action: 'IDLE' }]
        return json(res, sanitized)
      } catch (error) {
        if (USE_OFFLINE_FALLBACK) {
          const offline = mockInterpretPrompt(prompt, npcState, history)
          return json(res, { ...offline, _meta: { fallback: true, reason: error.message } })
        }
        return json(res, { error: 'Internal error', detail: error.message }, 500)
      }
    }

    // POST /api/generate-epilogue
    if (path === '/generate-epilogue') {
      if (!body || !body.outcome) return json(res, { error: 'outcome is required' }, 400)

      const epiloguePrompt = `你是《Prompt创世纪》的史官。以下是一局游戏的最终状态，请用古风叙事风格写一段50-100字的结局旁白。\n\n结局：${body.outcome === 'win' ? '文明延续' : body.outcome === 'lose_hunger' ? '全员饿死' : '大洪水淹没一切'}\n木材：${body.wood}，知识：${body.knowledge}，饱食度：${body.hunger}\n共降下神谕 ${body.promptsCast} 次。\n\n神谕记录：\n${(body.history || []).map((h, i) => `第${i + 1}谕：${h.prompt}${h.quality ? `（品质：${h.quality.rating}）` : ''}${h.worldEvent ? `→ 触发事件：${h.worldEvent.type}` : ''}`).join('\n')}\n\n请以第三人称、古风文风，写一段富有画面感的结局旁白。只输出叙事文本，不要解释。`

      const narrative = await callDeepSeekRaw([
        { role: 'system', content: '你是一个写古风叙事文本的AI。只输出叙事文本，不要有任何额外说明。' },
        { role: 'user', content: epiloguePrompt },
      ])

      return json(res, { narrative: narrative ?? generateMockEpilogue(body) })
    }

    // POST /api/generate-idle-event
    if (path === '/generate-idle-event') {
      const { timeLeft, wood, knowledge, hunger } = body || {}

      const idlePrompt = `你是《Prompt创世纪》的世界低语者。游戏正在进行中（倒计时 ${timeLeft ?? '?'} 秒）。请用 15-30 字写一句古风氛围描写。只输出叙事文本，不要解释。`
      const narrative = await callDeepSeekRaw([
        { role: 'system', content: '你是一个写古风氛围描写的AI。只输出一句叙事文本。' },
        { role: 'user', content: idlePrompt },
      ], 0.9, 100, 8000)

      return json(res, { narrative: narrative ?? pickIdleNarrative(body) })
    }

    return json(res, { error: 'not found' }, 404)
  } catch (error) {
    return json(res, { error: 'Internal error', detail: error.message }, 500)
  }
}

function pickIdleNarrative(state) {
  const { timeLeft, hunger } = state || {}
  if (hunger !== undefined && hunger <= 20) {
    return ['饥饿像潮水般蔓延，信徒们的脚步越来越沉重了。', '空空的胃在低鸣，古松林的树皮也快被啃光了。', '每个人都在节省体力——连呼吸都变得小心翼翼。'][Math.floor(Math.random() * 3)]
  }
  if (timeLeft !== undefined && timeLeft <= 15) return '水声越来越近了。空气中弥漫着一股潮湿的土腥味。'
  const pool = ['风吹过古松林，针叶发出细碎的私语。', '竹榻在微风中轻轻摇晃，发出吱呀的声响。', '书斋的窗纸透出暖黄的光，在暮色中摇曳。', '青花水墨般的水面泛起涟漪，一片寂静。', '远处传来一声鸟鸣，很快被风声吞没。', '岭南书斋的香炉升起一缕青烟，盘旋不散。', '宣纸般的草地上，露珠在夕阳下闪闪发光。', '阿衰翻了个身，竹榻又响了一声。', '古松的影子在地面上缓缓移动，时光流逝。', '一阵寒意从水面袭来，让人打了个寒颤。']
  return pool[Math.floor(Math.random() * pool.length)]
}
