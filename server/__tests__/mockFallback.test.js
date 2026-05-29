import { describe, it, expect } from 'vitest'
import { mockInterpretPrompt } from '../mockFallback.js'

const FOREST_X = 600, FOREST_Y = 150
const LIBRARY_X = 160, LIBRARY_Y = 360
const CAMP_X = 400, CAMP_Y = 540

describe('mockInterpretPrompt - empty / edge', () => {
  it('returns offline_empty_prompt for empty input', () => {
    const r = mockInterpretPrompt('')
    expect(r.eventName).toBe('offline_empty_prompt')
    expect(r.commands[0].npcName).toBe('阿衰')
  })

  it('returns offline_unrecognized for gibberish', () => {
    const r = mockInterpretPrompt('asdfgh jkl')
    expect(r.eventName).toBe('offline_unrecognized')
    // All three NPC speak
    expect(r.commands.length).toBeGreaterThanOrEqual(3)
  })
})

describe('mockInterpretPrompt - 阿强 (strongman)', () => {
  it('阿强 + 砍树 → WALK_TO forest + CHOP', () => {
    const r = mockInterpretPrompt('阿强去砍树')
    const cmds = r.commands.filter(c => c.npcName === '阿强')
    expect(cmds).toHaveLength(3)
    expect(cmds[0].action).toBe('WALK_TO')
    expect(cmds[0].targetX).toBe(FOREST_X)
    expect(cmds[0].targetY).toBe(FOREST_Y)
    expect(cmds[1].action).toBe('PLAY_ANIMATION')
    expect(cmds[1].animationType).toBe('CHOP')
    expect(r.stateImpact.woodDelta).toBe(2)
  })

  it('阿强 without keyword → generic walk + speak', () => {
    const r = mockInterpretPrompt('阿强干活')
    const cmds = r.commands.filter(c => c.npcName === '阿强')
    expect(cmds).toHaveLength(2)
    // Walks to center (400,300), not forest
    expect(cmds[0].targetX).toBe(400)
    expect(cmds[0].targetY).toBe(300)
    expect(cmds[1].action).toBe('SPEAK')
  })
})

describe('mockInterpretPrompt - 阿珍 (scholar)', () => {
  it('阿珍 + 读/书 → WALK_TO library + READ', () => {
    const r = mockInterpretPrompt('阿珍去读书')
    const cmds = r.commands.filter(c => c.npcName === '阿珍')
    expect(cmds[0].action).toBe('WALK_TO')
    expect(cmds[0].targetX).toBe(LIBRARY_X)
    expect(cmds[0].targetY).toBe(LIBRARY_Y)
    expect(cmds[1].animationType).toBe('READ')
    expect(r.stateImpact.knowledgeDelta).toBe(2)
  })

  it('阿珍 + 研究 → same as read', () => {
    const r = mockInterpretPrompt('请阿珍做研究')
    const cmds = r.commands.filter(c => c.npcName === '阿珍')
    const walkToLibrary = cmds.find(c => c.action === 'WALK_TO')
    expect(walkToLibrary?.targetX).toBe(LIBRARY_X)
  })

  it('阿珍 without keyword → just speak', () => {
    const r = mockInterpretPrompt('阿珍你好')
    const cmds = r.commands.filter(c => c.npcName === '阿珍')
    expect(cmds).toHaveLength(1)
    expect(cmds[0].action).toBe('SPEAK')
  })
})

describe('mockInterpretPrompt - 阿衰 (slacker)', () => {
  it('阿衰 + 躺/睡 → WALK_TO camp + SLEEP', () => {
    const r = mockInterpretPrompt('阿衰去躺平')
    const cmds = r.commands.filter(c => c.npcName === '阿衰')
    expect(cmds[0].action).toBe('WALK_TO')
    expect(cmds[0].targetX).toBe(CAMP_X)
    expect(cmds[0].targetY).toBe(CAMP_Y)
    // IDLE before SLEEP
    expect(cmds[1].action).toBe('IDLE')
    expect(cmds[2].animationType).toBe('SLEEP')
    expect(r.stateImpact.hungerDelta).toBe(8)
  })

  it('阿衰 + 休息 → same as sleep', () => {
    const r = mockInterpretPrompt('阿衰好好休息')
    const cmds = r.commands.filter(c => c.npcName === '阿衰')
    expect(cmds.find(c => c.animationType === 'SLEEP')).toBeDefined()
  })
})

describe('mockInterpretPrompt - combined commands', () => {
  it('handles multiple NPCs in one prompt', () => {
    const r = mockInterpretPrompt('阿强砍树，阿珍读书，阿衰睡觉')
    expect(r.commands.filter(c => c.npcName === '阿强').length).toBeGreaterThan(0)
    expect(r.commands.filter(c => c.npcName === '阿珍').length).toBeGreaterThan(0)
    expect(r.commands.filter(c => c.npcName === '阿衰').length).toBeGreaterThan(0)
    // Combined state: wood+2, knowledge+2, hunger+8-5=... wait, for 阿衰睡觉 hungerDelta=8
    // But the fallback also has a base -5 that applies always
    // Actually looking at the code: base stateImpact is {0,0,-5}, then overrides
    // After all overrides: woodDelta=2, knowledgeDelta=2, hungerDelta=8 (sleep overrides)
    expect(r.stateImpact.woodDelta).toBe(2)
    expect(r.stateImpact.knowledgeDelta).toBe(2)
  })
})

describe('mockInterpretPrompt - WorldEvent generation', () => {
  it('generates worldEvent for trigger keyword "风暴" with NPC command', () => {
    // Must include NPC name + trigger keyword to reach worldEvent code path
    const r = mockInterpretPrompt('暴风雨要来了！阿强去砍树，阿珍去读书')
    expect(r.worldEvent).toBeDefined()
    expect(r.worldEvent.type).toMatch(/^(STORM|RAIN|MOONLIGHT|SUPPLY_CACHE)$/)
    expect(typeof r.worldEvent.narrative).toBe('string')
    expect(r.worldEvent.narrative.length).toBeGreaterThan(0)
    expect(r.worldEvent.stateImpact).toBeDefined()
  })

  it('generates worldEvent for "天" keyword', () => {
    const r = mockInterpretPrompt('天有不测风云，阿强砍树')
    expect(r.worldEvent).toBeDefined()
  })

  it('no worldEvent for normal commands without trigger keywords', () => {
    const r = mockInterpretPrompt('阿强砍树')
    // '树' is not in the triggers list
    expect(r.worldEvent).toBeUndefined()
  })
})

describe('mockInterpretPrompt - Multi-turn memory (history)', () => {
  it('uses fatigued dialog when 阿衰 was abused last round', () => {
    const r = mockInterpretPrompt('阿衰去砍树', {}, ['阿强砍树', '阿衰砍树', '阿珍读书'])
    const slackerCmds = r.commands.filter(c => c.npcName === '阿衰')
    const speakCmd = slackerCmds.find(c => c.action === 'SPEAK')
    expect(speakCmd?.bubbleText).toMatch(/又干活/)
  })

  it('uses relieved dialog when 阿衰 was abused then allowed to rest', () => {
    const r = mockInterpretPrompt('阿衰去躺平', {}, ['阿强砍树', '阿衰砍树'])
    const slackerCmds = r.commands.filter(c => c.npcName === '阿衰')
    const speakCmd = slackerCmds.find(c => c.action === 'SPEAK')
    expect(speakCmd?.bubbleText).toMatch(/终于肯让我歇/)
  })

  it('uses normal dialog with no history', () => {
    const r = mockInterpretPrompt('阿衰去躺平')
    const slackerCmds = r.commands.filter(c => c.npcName === '阿衰')
    const speakCmd = slackerCmds.find(c => c.action === 'SPEAK')
    expect(speakCmd?.bubbleText).toMatch(/已躺平/)
  })

  it('uses normal dialog with empty history', () => {
    const r = mockInterpretPrompt('阿衰去躺平', {}, [])
    const slackerCmds = r.commands.filter(c => c.npcName === '阿衰')
    const speakCmd = slackerCmds.find(c => c.action === 'SPEAK')
    expect(speakCmd?.bubbleText).toMatch(/已躺平/)
  })
})
