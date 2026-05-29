import { describe, it, expect } from 'vitest'
import {
  createInitialGameState,
  applyStateImpact,
  tickSecond,
  evaluateSettlement,
  CHALLENGES,
  WIN_WOOD,
  WIN_KNOWLEDGE,
  INITIAL_TIME,
  BASE_HUNGER,
} from '../survivalState'

describe('createInitialGameState', () => {
  it('creates state with default values', () => {
    const s = createInitialGameState()
    expect(s.wood).toBe(0)
    expect(s.knowledge).toBe(0)
    expect(s.hunger).toBe(BASE_HUNGER)
    expect(s.timeLeft).toBe(INITIAL_TIME)
    expect(s.isGameOver).toBe(false)
  })
})

describe('applyStateImpact', () => {
  it('accumulates resource deltas', () => {
    const s = createInitialGameState()
    const r = applyStateImpact(s, { woodDelta: 3, knowledgeDelta: 1, hungerDelta: -15 })
    expect(r.wood).toBe(3)
    expect(r.knowledge).toBe(1)
    expect(r.hunger).toBe(85)
  })

  it('clamps hunger to [0, 100]', () => {
    const s = createInitialGameState()
    expect(applyStateImpact(s, { woodDelta: 0, knowledgeDelta: 0, hungerDelta: -999 }).hunger).toBe(0)
    expect(applyStateImpact(s, { woodDelta: 0, knowledgeDelta: 0, hungerDelta: 999 }).hunger).toBe(100)
  })

  it('clamps resources at 0 (never negative)', () => {
    const s = createInitialGameState()
    const r = applyStateImpact(s, { woodDelta: -10, knowledgeDelta: -5, hungerDelta: 0 })
    expect(r.wood).toBe(0)
    expect(r.knowledge).toBe(0)
  })

  it('is immutable (returns new object)', () => {
    const s = createInitialGameState()
    const r = applyStateImpact(s, { woodDelta: 2, knowledgeDelta: 0, hungerDelta: 0 })
    expect(s.wood).toBe(0)   // original unchanged
    expect(r.wood).toBe(2)   // new has value
    expect(r).not.toBe(s)
  })
})

describe('tickSecond', () => {
  it('decrements timeLeft by 1 each tick (regardless of elapsedSeconds)', () => {
    const s = createInitialGameState()
    expect(tickSecond(s, 1).timeLeft).toBe(59)
    // elapsedSeconds is not "how many seconds to advance", it tracks total elapsed
    // timeLeft always decrements by exactly 1
    expect(tickSecond(s, 999).timeLeft).toBe(59)
  })

  it('drains 2 hunger at every 5-second mark', () => {
    // elapsedSeconds % 5 === 0 triggers the drain
    let s = createInitialGameState()
    ;[1, 2, 3, 4, 5].forEach((sec) => {
      s = tickSecond(s, sec)
    })
    // at sec=5 the drain fires
    expect(s.hunger).toBe(BASE_HUNGER - 2)
  })

  it('does NOT drain hunger on non-5-second ticks', () => {
    let s = createInitialGameState()
    s = tickSecond(s, 1)
    s = tickSecond(s, 2)
    expect(s.hunger).toBe(BASE_HUNGER) // still full
  })

  it('does not tick when game is over', () => {
    const s = { ...createInitialGameState(), isGameOver: true }
    const r = tickSecond(s, 1)
    expect(r.timeLeft).toBe(INITIAL_TIME)
    expect(r.hunger).toBe(BASE_HUNGER)
  })

  it('clamps timeLeft at 0 (never negative)', () => {
    // tick past zero
    let s = { ...createInitialGameState(), timeLeft: 2 }
    s = tickSecond(s, 1) // 1
    s = tickSecond(s, 2) // 0
    s = tickSecond(s, 3) // should stay 0
    expect(s.timeLeft).toBe(0)
  })
})

describe('evaluateSettlement', () => {
  it('returns playing when game is active', () => {
    expect(evaluateSettlement(createInitialGameState())).toBe('playing')
  })

  it('returns lose_hunger when hunger hits 0', () => {
    const s = { ...createInitialGameState(), hunger: 0, timeLeft: 30 }
    expect(evaluateSettlement(s)).toBe('lose_hunger')
  })

  it('returns win when time runs out and resources meet threshold', () => {
    const s = { ...createInitialGameState(), wood: WIN_WOOD, knowledge: WIN_KNOWLEDGE, timeLeft: 0 }
    expect(evaluateSettlement(s)).toBe('win')
  })

  it('returns lose_timeout when time runs out but resources insufficient', () => {
    // wood=2 when need 3, knowledge=3 when need 3
    const s = { ...createInitialGameState(), wood: 2, knowledge: WIN_KNOWLEDGE, timeLeft: 0 }
    expect(evaluateSettlement(s)).toBe('lose_timeout')
    // knowledge insufficient
    const s2 = { ...createInitialGameState(), wood: WIN_WOOD, knowledge: 1, timeLeft: 0 }
    expect(evaluateSettlement(s2)).toBe('lose_timeout')
  })

  it('returns playing when game is already over (no double-settle)', () => {
    const s = { ...createInitialGameState(), isGameOver: true, timeLeft: 0 }
    expect(evaluateSettlement(s)).toBe('playing')
  })

  it('respects challenge win conditions', () => {
    const knowledgeChallenge = CHALLENGES.find(c => c.id === 'knowledge_first')
    // Standard: wood=0, knowledge=3 → lose_timeout (need knowledge>=5)
    const s = { ...createInitialGameState(), wood: 0, knowledge: 3, timeLeft: 0 }
    expect(evaluateSettlement(s, undefined, knowledgeChallenge)).toBe('lose_timeout')
    // With knowledge=5 → win
    const s2 = { ...createInitialGameState(), wood: 0, knowledge: 5, timeLeft: 0 }
    expect(evaluateSettlement(s2, undefined, knowledgeChallenge)).toBe('win')
  })

  it('respects challenge initialTime', () => {
    const hell = CHALLENGES.find(c => c.id === 'hell_30s')
    const s = createInitialGameState(undefined, hell)
    expect(s.timeLeft).toBe(30)
  })
})
