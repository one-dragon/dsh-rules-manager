/**
 * Where the rules block enters one step's message batch.
 *
 * Kept as a pure function so the placement rule is testable without a live
 * agent. The rule mirrors the host's own `dsh-agent-instructions` plugin,
 * which folds its context **right after the claimed batch**:
 *
 * > Fold the context right after the claimed batch, so the direct prompt
 * > precedes it and the driver-appended runtime context follows it.
 *
 * Appending to the end instead would put the rules block *after* the runtime
 * context the driver adds, which is the opposite of the intended reading order.
 */

/** The part of a message this module inspects; anything else is opaque. */
export interface StepMessage {
  [key: string]: unknown
}

/**
 * Whether a batch already carries this exact block.
 *
 * Compares the rendered text of each `text` block. The host compares a
 * structured payload identity; text equality is the equivalent check here,
 * because the rendered block is a pure function of the scanned rule set — two
 * equal texts always describe the same rules.
 */
export function carriesBlock(messages: readonly StepMessage[], block: string): boolean {
  return messages.some((message) => {
    const content = message['content']
    if (!Array.isArray(content)) return false
    return content.some((part) => {
      const piece = part as { type?: unknown; text?: unknown }
      return piece.type === 'text' && typeof piece.text === 'string' && piece.text === block
    })
  })
}

/** Why a step was left untouched, for diagnostics and tests. */
export type InjectionSkip =
  | 'empty-block'
  | 'no-claim'
  | 'already-present'

export interface InjectionPlan<T> {
  /** Messages to enter the step with, or the original array when nothing changes. */
  readonly messages: T[]
  /** Set when nothing was inserted. */
  readonly skipped?: InjectionSkip
}

/**
 * Insert `injection` immediately after the last claimed message.
 *
 * `claimed` is the payload's `messages` — the batch removed from the inbox for
 * this step (`runtime-types.ts`: "messages removed from the inbox for this
 * step"). `decisionMessages` is what the downstream `next()` returned, which
 * may already include driver-appended runtime context.
 *
 * Position is `lastClaimedIndex + 1`, so:
 *   claimed... | injection | driver-appended context
 * When no claimed message appears in the decision, the injection is prepended:
 * that happens on a step with nothing of its own to say, and the rules block
 * still belongs ahead of any context that follows.
 *
 * A step with **no claimed messages at all** is left alone. That is the
 * empty-first-batch case the host also guards: with no user message the turn
 * owns no request, and injecting would manufacture one.
 */
export function planInjection<T, J>(
  decisionMessages: readonly T[],
  claimed: readonly unknown[],
  injection: J,
  block: string,
): InjectionPlan<T | J> {
  const unchanged: (T | J)[] = [...decisionMessages]
  if (block === '') return { messages: unchanged, skipped: 'empty-block' }
  if (claimed.length === 0) return { messages: unchanged, skipped: 'no-claim' }
  if (carriesBlock(decisionMessages as readonly StepMessage[], block)) {
    return { messages: unchanged, skipped: 'already-present' }
  }

  let lastClaimedIndex = -1
  const claimedSet = new Set<unknown>(claimed)
  for (let i = decisionMessages.length - 1; i >= 0; i--) {
    const message = decisionMessages[i]
    if (message !== undefined && claimedSet.has(message)) { lastClaimedIndex = i; break }
  }

  const at = lastClaimedIndex + 1
  return { messages: [...decisionMessages.slice(0, at), injection, ...decisionMessages.slice(at)] }
}
