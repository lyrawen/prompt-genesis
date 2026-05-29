import { describe, it, expect } from 'vitest'
import { _testOnly } from '../divineApi.js'

const { sanitizeLLMResponse, sanitizeStateImpact, sanitizeCommands, sanitizeWorldEvent, sanitizeAfterShock, sanitizeMapMutation, stripMarkdownJson, pickIdleNarrative } = _testOnly()

describe('stripMarkdownJson', () => {
  it('removes ```json fence', () => {
    const raw = '```json\n{"key": "value"}\n```'
    expect(stripMarkdownJson(raw)).toBe('{"key": "value"}')
  })

  it('removes ``` fence (no language)', () => {
    const raw = '```\n{"key": "value"}\n```'
    expect(stripMarkdownJson(raw)).toBe('{"key": "value"}')
  })

  it('leaves bare JSON untouched', () => {
    const raw = '{"key": "value"}'
    expect(stripMarkdownJson(raw)).toBe(raw)
  })

  it('handles whitespace around fences', () => {
    const raw = '  ```json\n  {"x": 1}\n  ```  '
    const result = stripMarkdownJson(raw)
    expect(result).toBe('{"x": 1}')
  })
})

describe('sanitizeCommands', () => {
  it('validates NPC names', () => {
    const cmds = sanitizeCommands([
      { npcName: '阿强', action: 'WALK_TO' },
      { npcName: 'Invalid', action: 'WALK_TO' },
    ])
    expect(cmds).toHaveLength(2)
    expect(cmds[0].npcName).toBe('阿强')
    // invalid name defaults to 阿衰
    expect(cmds[1].npcName).toBe('阿衰')
  })

  it('defaults unknown actions to IDLE', () => {
    const cmds = sanitizeCommands([{ npcName: '阿珍', action: 'FLY' }])
    expect(cmds[0].action).toBe('IDLE')
  })

  it('truncates bubbleText to 80 chars', () => {
    const cmds = sanitizeCommands([{ npcName: '阿珍', action: 'SPEAK', bubbleText: 'a'.repeat(200) }])
    expect(cmds[0].bubbleText.length).toBe(80)
  })

  it('handles null/undefined commands gracefully', () => {
    expect(sanitizeCommands(null)).toEqual([])
    expect(sanitizeCommands(undefined)).toEqual([])
  })
})

describe('sanitizeStateImpact', () => {
  it('preserves valid numbers', () => {
    const r = sanitizeStateImpact({ woodDelta: 3, knowledgeDelta: -1, hungerDelta: -10 })
    expect(r.woodDelta).toBe(3)
    expect(r.knowledgeDelta).toBe(-1)
    expect(r.hungerDelta).toBe(-10)
  })

  it('falls back for null/non-object', () => {
    const r = sanitizeStateImpact(null)
    expect(r.woodDelta).toBe(0)
    expect(r.hungerDelta).toBe(-5)
  })

  it('coerces string numbers to numbers', () => {
    const r = sanitizeStateImpact({ woodDelta: '2', knowledgeDelta: '1', hungerDelta: '-5' })
    expect(r.woodDelta).toBe(2)
    expect(r.knowledgeDelta).toBe(1)
    expect(r.hungerDelta).toBe(-5)
  })
})

describe('sanitizeWorldEvent', () => {
  it('sanitizes valid world event', () => {
    const ev = sanitizeWorldEvent({
      type: 'STORM',
      narrative: '风暴来了',
      stateImpact: { woodDelta: 2, knowledgeDelta: -1, hungerDelta: -5 },
    })
    expect(ev.type).toBe('STORM')
    expect(ev.narrative).toBe('风暴来了')
    expect(ev.stateImpact.woodDelta).toBe(2)
  })

  it('returns undefined for invalid type', () => {
    expect(sanitizeWorldEvent({ type: 'INVALID', narrative: 'x', stateImpact: {} })).toBeUndefined()
  })

  it('returns undefined for empty narrative', () => {
    expect(sanitizeWorldEvent({ type: 'RAIN', narrative: '', stateImpact: {} })).toBeUndefined()
  })

  it('returns undefined for non-object', () => {
    expect(sanitizeWorldEvent(null)).toBeUndefined()
    expect(sanitizeWorldEvent('string')).toBeUndefined()
  })
})

describe('sanitizeAfterShock', () => {
  it('sanitizes valid afterShock', () => {
    const as = _testOnly().sanitizeAfterShock({
      delayMs: 5000,
      worldEvent: { type: 'RAIN', narrative: '下雨了', stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 } },
    })
    expect(as.delayMs).toBe(5000)
    expect(as.worldEvent.type).toBe('RAIN')
  })

  it('rejects delayMs out of range', () => {
    expect(_testOnly().sanitizeAfterShock({ delayMs: 500, worldEvent: { type: 'RAIN', narrative: 'x', stateImpact: {} } })).toBeUndefined()
    expect(_testOnly().sanitizeAfterShock({ delayMs: 50000, worldEvent: { type: 'RAIN', narrative: 'x', stateImpact: {} } })).toBeUndefined()
  })

  it('rejects invalid worldEvent inside afterShock', () => {
    expect(_testOnly().sanitizeAfterShock({ delayMs: 5000, worldEvent: { type: 'INVALID', narrative: 'x', stateImpact: {} } })).toBeUndefined()
  })
})

describe('sanitizeLLMResponse (integration)', () => {
  it('parses a full valid response with worldEvent', () => {
    const raw = {
      eventName: 'divine_command',
      commands: [
        { npcName: '阿强', action: 'WALK_TO', targetX: 600, targetY: 150, animationType: 'CHOP' },
        { npcName: '阿珍', action: 'SPEAK', bubbleText: '遵命。' },
        { npcName: '阿衰', action: 'IDLE' },
      ],
      stateImpact: { woodDelta: 2, knowledgeDelta: 1, hungerDelta: -8 },
      worldEvent: {
        type: 'MOONLIGHT',
        narrative: '月光洒落，林间清明。',
        stateImpact: { woodDelta: 0, knowledgeDelta: 1, hungerDelta: 2 },
      },
      afterShock: {
        delayMs: 5000,
        worldEvent: { type: 'RAIN', narrative: '雨后泥土芬芳。', stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 } },
      },
    }
    const r = sanitizeLLMResponse(raw)
    expect(r.eventName).toBe('divine_command')
    expect(r.commands).toHaveLength(3)
    expect(r.stateImpact.woodDelta).toBe(2)
    expect(r.worldEvent).toBeDefined()
    expect(r.worldEvent.type).toBe('MOONLIGHT')
    expect(r.worldEvent.narrative).toBe('月光洒落，林间清明。')
    expect(r.afterShock).toBeDefined()
    expect(r.afterShock.delayMs).toBe(5000)
    expect(r.afterShock.worldEvent.type).toBe('RAIN')
  })

  it('parses fenced markdown JSON strings', () => {
    const raw = '```json\n{"eventName":"md_test","commands":[{"npcName":"阿强","action":"IDLE"}],"stateImpact":{"woodDelta":0,"knowledgeDelta":0,"hungerDelta":0}}\n```'
    const r = sanitizeLLMResponse(raw)
    expect(r.eventName).toBe('md_test')
  })

  it('sanitizes mapMutation in full response', () => {
    const raw = {
      eventName: 'build_test',
      commands: [{ npcName: '阿强', action: 'IDLE' }],
      stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
      mapMutation: { type: 'BUILD', target: 'camp', description: '搭起了一个小篝火。' },
    }
    const r = sanitizeLLMResponse(raw)
    expect(r.mapMutation).toBeDefined()
    expect(r.mapMutation.type).toBe('BUILD')
    expect(r.mapMutation.target).toBe('camp')
    expect(r.mapMutation.description).toBe('搭起了一个小篝火。')
  })

  it('rejects invalid mapMutation type', () => {
    expect(sanitizeLLMResponse({
      eventName: 'x', commands: [{ npcName: '阿强', action: 'IDLE' }],
      stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
      mapMutation: { type: 'INVALID', target: 'camp', description: 'x' },
    }).mapMutation).toBeUndefined()
  })

  it('returns fallback for completely malformed input', () => {
    const r = sanitizeLLMResponse('not even json')
    expect(r.eventName).toBe('hallucination_guard')
    expect(r.commands[0].npcName).toBe('阿衰')
    expect(r.stateImpact.hungerDelta).toBe(-2)
  })
})

describe('pickIdleNarrative (AI Game Master)', () => {
  it('returns hunger-themed text when hunger <= 20', () => {
    const text = pickIdleNarrative({ timeLeft: 30, wood: 0, knowledge: 0, hunger: 15 })
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(5)
    expect(text).toMatch(/饥饿|饿|沉重|体力|呼吸|树皮/)
  })

  it('returns flood-themed text when timeLeft <= 15', () => {
    const text = pickIdleNarrative({ timeLeft: 10, wood: 0, knowledge: 0, hunger: 50 })
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(5)
    expect(text).toMatch(/水声|潮湿|土腥/)
  })

  it('returns general atmospheric text for normal state', () => {
    const text = pickIdleNarrative({ timeLeft: 40, wood: 2, knowledge: 1, hunger: 70 })
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(5)
  })
})
