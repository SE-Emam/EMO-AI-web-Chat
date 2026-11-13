/**
 * ToolPipelineLogger — structured event emitter for tracing the tool calling
 * lifecycle. Each event carries a correlation ID for end-to-end tracing.
 */

export interface ToolPipelineEvent {
  correlationId: string;
  event: string;
  timestamp: number;
  [key: string]: unknown;
}

export type ToolPipelineEventHandler = (event: ToolPipelineEvent) => void;

export class ToolPipelineLogger {
  constructor(
    private correlationId: string,
    private handler: ToolPipelineEventHandler
  ) {}

  private emit(event: string, extra?: Record<string, unknown>): void {
    this.handler({
      correlationId: this.correlationId,
      event,
      timestamp: Date.now(),
      ...extra,
    });
  }

  toolDefinitionsBuilt(toolCount: number): void {
    this.emit('tool_definitions_built', { toolCount });
  }

  toolDefinitionsSent(protocol: string): void {
    this.emit('tool_definitions_sent', { protocol });
  }

  modelResponseReceived(hasToolCalls: boolean): void {
    this.emit('model_response_received', { hasToolCalls });
  }

  toolCallDetected(callId: string, toolName: string): void {
    this.emit('tool_call_detected', { callId, toolName });
  }

  toolDispatchStarted(callId: string, toolName: string): void {
    this.emit('tool_dispatch_started', { callId, toolName });
  }

  toolDispatchCompleted(callId: string, toolName: string, success: boolean): void {
    this.emit('tool_dispatch_completed', { callId, toolName, success });
  }

  toolResultReturned(callId: string, toolName: string): void {
    this.emit('tool_result_returned', { callId, toolName });
  }

  toolCallValidationFailed(callId: string, toolName: string, reason: string): void {
    this.emit('tool_call_validation_failed', { callId, toolName, reason });
  }

  modelContinuationStarted(): void {
    this.emit('model_continuation_started');
  }

  modelFinalResponseReceived(): void {
    this.emit('model_final_response_received');
  }

  toolRefusalDetected(): void {
    this.emit('tool_refusal_detected');
  }

  toolDispatchFailed(callId: string, toolName: string, reason: string): void {
    this.emit('tool_dispatch_failed', { callId, toolName, reason });
  }

  /** P2 — the tools announced in THIS request (the complete toolset). */
  toolAvailableInRequest(toolCount: number): void {
    this.emit('tool_available_in_request', { toolCount });
  }

  /**
   * P2 — the model invented an external dependency / asserted an unconfirmed
   * connection problem. Only the classification and a safe fingerprint are
   * logged — never the raw model text.
   */
  unsupportedDependencyClaimDetected(fingerprint: string, category: string): void {
    this.emit('unsupported_dependency_claim_detected', { fingerprint, category });
  }

  /** P2 — a single neutral correction was issued (reason only). */
  neutralCorrectionAttempted(reason: string): void {
    this.emit('neutral_correction_attempted', { reason });
  }

  /** P2 — a REAL transport failure was confirmed by the dispatcher. */
  transportFailureConfirmed(reason: string): void {
    this.emit('transport_failure_confirmed', { reason });
  }
}
