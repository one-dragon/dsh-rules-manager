import { describe, expect, it } from 'vitest'
import { carriesBlock, planInjection } from '../src/inject.ts'

/** A message stand-in carrying one text block. */
const text = (t: string) => ({ content: [{ type: 'text', text: t }] })
const other = (tag: string) => ({ tag })

describe('carriesBlock', () => {
  it('finds a message carrying the exact block', () => {
    expect(carriesBlock([text('hello')], 'hello')).toBe(true)
  })

  it('does not match a different text', () => {
    expect(carriesBlock([text('hello')], 'world')).toBe(false)
  })

  it('does not match a prefix or suffix', () => {
    expect(carriesBlock([text('hello world')], 'hello')).toBe(false)
  })

  it('finds the block among several text parts', () => {
    const message = { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'target' }] }
    expect(carriesBlock([message], 'target')).toBe(true)
  })

  it('ignores non-text parts', () => {
    const message = { content: [{ type: 'image', text: 'target' }] }
    expect(carriesBlock([message], 'target')).toBe(false)
  })

  it('tolerates messages with no content or non-array content', () => {
    expect(carriesBlock([{}, { content: 'string' }, { content: null }], 'x')).toBe(false)
  })

  it('returns false for an empty batch', () => {
    expect(carriesBlock([], 'x')).toBe(false)
  })
})

describe('planInjection — placement', () => {
  // Identity matters: the claimed batch is matched against the decision by
  // reference, exactly as the host does (`messages.includes(message)`). So the
  // same object instance must appear in both arrays.
  const claimedMessage = text('user prompt')
  const injection = text('RULES')

  it('inserts immediately after the last claimed message', () => {
    const context = other('runtime-context')
    const decision = [claimedMessage, context]
    const plan = planInjection(decision, [claimedMessage], injection, 'RULES')
    expect(plan.skipped).toBeUndefined()
    expect(plan.messages.length).toBe(3)
    // direct prompt -> rules -> driver-appended context
    expect(plan.messages[0]).toBe(claimedMessage)
    expect(plan.messages[1]).toBe(injection)
    expect(plan.messages[2]).toBe(context)
  })

  it('uses the LAST claimed message when several are claimed', () => {
    const a = text('first')
    const b = text('second')
    const context = other('context')
    const decision = [a, b, context]
    const plan = planInjection(decision, [a, b], injection, 'RULES')
    // Both are claimed, so the injection lands after b (index 1) -> index 2.
    expect(plan.messages[0]).toBe(a)
    expect(plan.messages[1]).toBe(b)
    expect(plan.messages[2]).toBe(injection)
    expect(plan.messages[3]).toBe(context)
    expect(plan.messages.length).toBe(4)
  })

  it('prepends when the decision carries no claimed message', () => {
    const decision = [other('a'), other('b')]
    const plan = planInjection(decision, [claimedMessage], injection, 'RULES')
    expect(plan.messages[0]).toBe(injection)
    expect(plan.messages.length).toBe(3)
  })

  it('appends when the claimed message is already last', () => {
    const decision = [claimedMessage]
    const plan = planInjection(decision, [claimedMessage], injection, 'RULES')
    expect(plan.messages[0]).toBe(claimedMessage)
    expect(plan.messages[1]).toBe(injection)
  })

  it('does not mutate the input array', () => {
    const decision = [claimedMessage]
    const before = decision.length
    planInjection(decision, [claimedMessage], injection, 'RULES')
    expect(decision.length).toBe(before)
  })

  it('matches claimed messages by identity, not by content', () => {
    // A different object with identical content is not the claimed instance.
    const decision = [text('user prompt'), other('ctx')]
    const plan = planInjection(decision, [text('user prompt')], injection, 'RULES')
    // No identity match, so it prepends rather than inserting after index 0.
    expect(plan.messages[0]).toBe(injection)
  })
})

describe('planInjection — skips', () => {
  const claimedMessage = text('user prompt')
  const injection = text('RULES')

  it('skips an empty block', () => {
    const plan = planInjection([claimedMessage], [claimedMessage], injection, '')
    expect(plan.skipped).toBe('empty-block')
    expect(plan.messages.length).toBe(1)
  })

  it('skips a step that claimed nothing (the empty-first-batch case)', () => {
    const decision = [other('context')]
    const plan = planInjection(decision, [], injection, 'RULES')
    expect(plan.skipped).toBe('no-claim')
    expect(plan.messages).toEqual(decision)
  })

  it('skips when the decision already carries the block', () => {
    const decision = [claimedMessage, text('RULES')]
    const plan = planInjection(decision, [claimedMessage], injection, 'RULES')
    expect(plan.skipped).toBe('already-present')
    expect(plan.messages.length).toBe(2)
  })

  it('reports empty-block before no-claim when both apply', () => {
    expect(planInjection([], [], injection, '').skipped).toBe('empty-block')
  })

  it('returns a plain array even when skipping', () => {
    const plan = planInjection(Object.freeze([other('a')]), [], injection, 'RULES')
    expect(Array.isArray(plan.messages)).toBe(true)
  })
})
