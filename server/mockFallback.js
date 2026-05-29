/** Offline keyword router — used when DeepSeek is unreachable. */

const AFTERSHOCK_EVENTS = [
  { type: 'WILD_BOAR', narrative: '砍树的动静惊醒了灌木中的野猪！它怒气冲冲地跑远了。', stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 } },
  { type: 'FIND_SUPPLIES', narrative: '翻书时一封信笺飘落，里面夹着一片风干的草药。', stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 } },
  { type: 'RAIN', narrative: '刚刚还晴空万里，转眼间细雨绵绵。', stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 } },
  { type: 'MOONLIGHT', narrative: '云层散开，月光洒在竹榻上，一片清辉。', stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 } },
]

function pickAfterShock() {
  return AFTERSHOCK_EVENTS[Math.floor(Math.random() * AFTERSHOCK_EVENTS.length)]
}

/** Offline keyword router — used when DeepSeek is unreachable. */

const WORLD_EVENTS = [
  {
    type: 'RAIN',
    narrative: '天空飘起细雨，书页微微湿润，但万物生长。',
    stateImpact: { woodDelta: 1, knowledgeDelta: 0, hungerDelta: -3 },
  },
  {
    type: 'MOONLIGHT',
    narrative: '月光洒落，林间一片清明，信徒们精神为之一振。',
    stateImpact: { woodDelta: 0, knowledgeDelta: 1, hungerDelta: 2 },
  },
  {
    type: 'STORM',
    narrative: '狂风骤起！古松林落下几根断枝。',
    stateImpact: { woodDelta: 2, knowledgeDelta: -1, hungerDelta: -5 },
  },
  {
    type: 'SUPPLY_CACHE',
    narrative: '阿衰在竹榻下发现了一包干粮！',
    stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 10 },
  },
]

function pickRandomEvent() {
  return WORLD_EVENTS[Math.floor(Math.random() * WORLD_EVENTS.length)]
}

function shouldGenerateEvent(text) {
  const triggers = ['风暴', '雨', '天', '自然', '天气', '环境', '事件', '发生', '突然', '来点', '意外', '惊喜', '灾难', '赐予', '降下']
  return triggers.some(t => text.includes(t))
}
export function mockInterpretPrompt(input, npcState, history) {
  const text = input.trim()

  const slackerResistance = npcState?.阿衰?.resistance ?? 0
  const wasSlackerAbusedLastRound = history?.some(h => h.includes('阿衰') && !h.includes('躺') && !h.includes('睡') && !h.includes('休息'))

  if (!text) {
    return {
      eventName: 'offline_empty_prompt',
      commands: [{ npcName: '阿衰', action: 'SPEAK', bubbleText: '……神谕呢？我躺好了。' }],
      stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
    }
  }

  const commands = []

  if (text.includes('阿强')) {
    if (text.includes('砍树') || text.includes('树')) {
      commands.push({ npcName: '阿强', action: 'WALK_TO', targetX: 600, targetY: 150 })
      commands.push({ npcName: '阿强', action: 'PLAY_ANIMATION', animationType: 'CHOP' })
      commands.push({ npcName: '阿强', action: 'SPEAK', bubbleText: '嘿！这棵树归我了！' })
    } else {
      commands.push({ npcName: '阿强', action: 'WALK_TO', targetX: 400, targetY: 300 })
      commands.push({ npcName: '阿强', action: 'SPEAK', bubbleText: '老大，有何吩咐？' })
    }
  }

  if (text.includes('阿珍')) {
    if (text.includes('读') || text.includes('书') || text.includes('研究')) {
      commands.push({ npcName: '阿珍', action: 'WALK_TO', targetX: 160, targetY: 360 })
      commands.push({ npcName: '阿珍', action: 'PLAY_ANIMATION', animationType: 'READ' })
      commands.push({ npcName: '阿珍', action: 'SPEAK', bubbleText: '嗯……这本古籍颇有深意。' })
    } else {
      commands.push({ npcName: '阿珍', action: 'SPEAK', bubbleText: '我在听，请继续神谕。' })
    }
  }

  if (text.includes('阿衰')) {
    if (text.includes('躺') || text.includes('平') || text.includes('睡') || text.includes('休息')) {
      const relief = wasSlackerAbusedLastRound ? '终于肯让我歇会儿了……' : slackerResistance > 50 ? '唉……终于可以躺了。' : '收到，已躺平。勿扰。'
      commands.push({ npcName: '阿衰', action: 'WALK_TO', targetX: 400, targetY: 540 })
      commands.push({ npcName: '阿衰', action: 'IDLE' })
      commands.push({ npcName: '阿衰', action: 'PLAY_ANIMATION', animationType: 'SLEEP' })
      commands.push({ npcName: '阿衰', action: 'SPEAK', bubbleText: relief })
    } else {
      const fatigue = wasSlackerAbusedLastRound ? '又干活？上次累的还没缓过来……' : ''
      const grumble = fatigue || (slackerResistance > 70 ? '……又是我？你们是不是针对我。' : slackerResistance > 40 ? '能不能别叫我……' : '能不能别叫我……我想躺。')
      commands.push({ npcName: '阿衰', action: 'SPEAK', bubbleText: grumble })
      if (slackerResistance > 60) {
        commands.push({ npcName: '阿衰', action: 'IDLE' })
      }
    }
  }

  if (commands.length === 0) {
    return {
      eventName: 'offline_unrecognized',
      commands: [
        { npcName: '阿强', action: 'SPEAK', bubbleText: '听不懂神谕……' },
        { npcName: '阿珍', action: 'SPEAK', bubbleText: '请点名：阿强、阿珍、阿衰。' },
        { npcName: '阿衰', action: 'SPEAK', bubbleText: '算了，我继续躺。' },
      ],
      stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: -2 },
    }
  }

  const stateImpact = { woodDelta: 0, knowledgeDelta: 0, hungerDelta: -5 }
  if (text.includes('砍树') || text.includes('树')) stateImpact.woodDelta = 2
  if (text.includes('读') || text.includes('书')) stateImpact.knowledgeDelta = 2
  if (text.includes('躺') || text.includes('休息')) stateImpact.hungerDelta = 8

  const result = { eventName: 'offline_fallback', commands, stateImpact }

  // Quality rating heuristic for mock mode
  const quality = assessQuality(text)
  if (quality) result.quality = quality

  // Maybe add a narrative world event
  if (shouldGenerateEvent(text)) {
    result.worldEvent = pickRandomEvent()
  }

  // 25% chance of afterShock for prompts with NPC commands, 50% if quality is high
  const qRating = result.quality?.rating
  const hasCommands = commands.length > 0
  if (hasCommands) {
    const shockChance = qRating === '神谕' ? 0.5 : 0.25
    if (Math.random() < shockChance) {
      result.afterShock = { delayMs: 5000, worldEvent: pickAfterShock() }
    }
  }

  return result
}

/** Simple offline quality heuristic based on prompt richness. */
function assessQuality(text) {
  if (text.length < 4 || /^[a-zA-Z\s]+$/.test(text)) return undefined // gibberish → no rating

  const hasScene = /[风景天地风云雨雪月山水林海]/.test(text)
  const hasNarrative = /[因为所以为了于是让请求命令保护]/.test(text)
  const hasEmotion = /[急快赶紧努力拼命认真团结]/.test(text)
  const score = [hasScene, hasNarrative, hasEmotion].filter(Boolean).length

  if (score >= 2) return { rating: '神谕', comment: '字字珠玑，天地动容……' }
  if (score >= 1) return { rating: '优秀', comment: '此谕有理有据。' }
  return undefined // 普通 → no rating needed, just standard processing
}

/** Generate a mock epilogue narrative. */
export function generateMockEpilogue(body) {
  const { outcome, wood, knowledge, promptsCast } = body || {}
  if (outcome === 'win') {
    return `大洪水退去后，古松林只剩下一截树桩。阿强扛着 ${wood} 根木材从废墟中站起，阿珍怀抱着 ${knowledge} 卷古籍走出书斋。历经 ${promptsCast} 道神谕的指引，文明的火种终究没有熄灭。`
  }
  if (outcome === 'lose_hunger') {
    return `饥饿比洪水更先到达。竹榻上的阿衰最后一个闭上眼睛，岭南书斋的灯火在风中熄灭。${promptsCast} 道神谕没能换来一粒米。文明，死于饥荒。`
  }
  return `洪水吞没了一切。${promptsCast} 道神谕的回声在水面回荡，但无人应答。古松森林、岭南书斋、竹榻营地——全部沉入青花水墨般的深渊。`
}
