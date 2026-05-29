import { describe, it, expect } from 'vitest'
import { parseLLMResponse } from '../divineCommand'

describe('parseLLMResponse', () => {
  it('parses a valid LLM response with commands and stateImpact', () => {
    const input = {
      eventName: 'divine_command',
      commands: [
        { npcName: '阿强', action: 'WALK_TO', targetX: 600, targetY: 150, animationType: 'CHOP', bubbleText: '来力！' },
        { npcName: '阿珍', action: 'SPEAK', bubbleText: '遵命。' },
        { npcName: '阿衰', action: 'IDLE' },
      ],
      stateImpact: { woodDelta: 2, knowledgeDelta: 0, hungerDelta: -5 },
    }
    const r = parseLLMResponse(input)
    expect(r.eventName).toBe('divine_command')
    expect(r.commands).toHaveLength(3)
    expect(r.commands[0].npcName).toBe('阿强')
    expect(r.commands[0].targetX).toBe(600)
    expect(r.stateImpact.woodDelta).toBe(2)
    expect(r.stateImpact.hungerDelta).toBe(-5)
  })

  it('returns hallucination_guard for null / non-object input', () => {
    expect(parseLLMResponse(null).eventName).toBe('hallucination_guard')
    expect(parseLLMResponse(undefined).eventName).toBe('hallucination_guard')
    expect(parseLLMResponse('string').eventName).toBe('hallucination_guard')
    expect(parseLLMResponse(42).eventName).toBe('hallucination_guard')
  })

  it('filters out commands with invalid NPC names', () => {
    const input = {
      eventName: 'test',
      commands: [
        { npcName: '李四', action: 'WALK_TO' },                    // invalid name
        { npcName: '阿珍', action: 'WALK_TO', targetX: 160, targetY: 360 },
        { npcName: 'Invalid', action: 'SPEAK' },                   // invalid name
      ],
      stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
    }
    const r = parseLLMResponse(input)
    // Only 阿珍 remains; filtered commands get fallback appended
    expect(r.commands.length).toBeGreaterThanOrEqual(1)
    expect(r.commands.every((c) => ['阿强', '阿珍', '阿衰'].includes(c.npcName))).toBe(true)
  })

  it('defaults invalid actions to IDLE', () => {
    const input = {
      eventName: 'test',
      commands: [{ npcName: '阿强', action: 'FLY_AWAY' }],
      stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
    }
    const r = parseLLMResponse(input)
    expect(r.commands[0].action).toBe('IDLE')
  })

  it('truncates bubbleText to 80 characters', () => {
    const longText = 'x'.repeat(200)
    const input = {
      eventName: 'test',
      commands: [{ npcName: '阿强', action: 'SPEAK', bubbleText: longText }],
      stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
    }
    const r = parseLLMResponse(input)
    expect(r.commands[0].bubbleText!.length).toBeLessThanOrEqual(80)
  })

  it('falls back to safe impact when stateImpact is not an object', () => {
    const input1 = {
      eventName: 'test',
      commands: [{ npcName: '阿珍', action: 'IDLE' }],
      stateImpact: 'invalid',
    }
    const r1 = parseLLMResponse(input1)
    // Hallucination guard fallback has hungerDelta: -2
    expect(r1.stateImpact.hungerDelta).toBe(-2)

    const input2 = {
      eventName: 'test',
      commands: [{ npcName: '阿珍', action: 'IDLE' }],
      stateImpact: null,
    }
    const r2 = parseLLMResponse(input2)
    expect(r2.stateImpact.hungerDelta).toBe(-2)
  })

  describe('worldEvent', () => {
    it('parses a valid world event', () => {
      const input = {
        eventName: 'test',
        commands: [{ npcName: '阿衰', action: 'IDLE' }],
        stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
        worldEvent: {
          type: 'STORM',
          narrative: '狂风骤起！古松林落下几根断枝。',
          stateImpact: { woodDelta: 2, knowledgeDelta: -1, hungerDelta: -5 },
        },
      }
      const r = parseLLMResponse(input)
      expect(r.worldEvent).toBeDefined()
      expect(r.worldEvent!.type).toBe('STORM')
      expect(r.worldEvent!.narrative).toBe('狂风骤起！古松林落下几根断枝。')
      expect(r.worldEvent!.stateImpact.woodDelta).toBe(2)
    })

    it('rejects world event with invalid type', () => {
      const input = {
        eventName: 'test',
        commands: [{ npcName: '阿衰', action: 'IDLE' }],
        stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
        worldEvent: {
          type: 'NUKE',
          narrative: 'boom',
          stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
        },
      }
      expect(parseLLMResponse(input).worldEvent).toBeUndefined()
    })

    it('rejects world event with empty narrative', () => {
      const input = {
        eventName: 'test',
        commands: [{ npcName: '阿衰', action: 'IDLE' }],
        stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
        worldEvent: {
          type: 'RAIN',
          narrative: '',
          stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
        },
      }
      expect(parseLLMResponse(input).worldEvent).toBeUndefined()
    })

    it('tolerates missing worldEvent field', () => {
      const input = {
        eventName: 'test',
        commands: [{ npcName: '阿衰', action: 'IDLE' }],
        stateImpact: { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 0 },
      }
      const r = parseLLMResponse(input)
      expect(r.worldEvent).toBeUndefined()
    })
  })
})
