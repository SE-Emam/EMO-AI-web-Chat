/**
 * Shared markers for the tool-bridge correction channel (P2).
 *
 * The marker lets the web driver recognise a message that EMO itself issued
 * (a neutral correction) and EXCLUDE it from the stored client history —
 * without ever dropping it from the prompt that reaches the model. Keeping
 * it out of the stored history preserves the client's message prefix, so the
 * NEXT client turn still continues the same web conversation.
 *
 * The marker is a neutral sentence — it names no external project and
 * repeats no model claim.
 */
export const NEUTRAL_CORRECTION_MARKER =
  'The tools announced in this request are available now';

export interface BridgeMessageLike {
  role?: string;
  content?: unknown;
}

/** True for the neutral-correction message EMO issues on its own initiative. */
export function isNeutralCorrectionMessage(message: BridgeMessageLike | null | undefined): boolean {
  if (!message || message.role !== 'user') return false;
  const content = typeof message.content === 'string' ? message.content : '';
  return content.includes(NEUTRAL_CORRECTION_MARKER);
}

/**
 * Removes EMO-issued neutral corrections from a client history list. User
 * messages, tool calls and tool results are never touched.
 */
export function stripNeutralCorrections<T extends BridgeMessageLike>(messages: T[]): T[] {
  return messages.filter((m) => !isNeutralCorrectionMessage(m));
}
