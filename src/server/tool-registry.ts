/**
 * ToolRegistry — single source of truth for tool definitions, validation,
 * and compact serialization for injection into model prompts.
 */

export interface ToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OpenAIToolDef {
  type?: 'function';
  function: ToolFunction;
}

export interface CompactToolDef {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Normalize a tool call from various formats (OpenAI, parsed text) into a
 * consistent shape. Returns null when the input is not a recognisable tool call.
 */
export function normalizeToolCall(raw: unknown, index: number): NormalizedToolCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // OpenAI format: { id, type:'function', function:{ name, arguments } }
  if (obj.function && typeof obj.function === 'object') {
    const fn = obj.function as Record<string, unknown>;
    const name = fn.name;
    if (!name || typeof name !== 'string') return null;
    const id = typeof obj.id === 'string' ? obj.id : `call_${Date.now()}_${index}`;
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === 'string') {
      try { args = JSON.parse(fn.arguments); } catch { args = {}; }
    } else if (fn.arguments && typeof fn.arguments === 'object') {
      args = fn.arguments as Record<string, unknown>;
    }
    return { id, name, arguments: args };
  }

  // Parsed text format: { name, arguments }
  const name = obj.name;
  if (!name || typeof name !== 'string') return null;
  const id = typeof obj.id === 'string' ? obj.id : `call_${Date.now()}_${index}`;
  let args: Record<string, unknown> = {};
  if (typeof obj.arguments === 'string') {
    try { args = JSON.parse(obj.arguments as string); } catch { args = {}; }
  } else if (obj.arguments && typeof obj.arguments === 'object') {
    args = obj.arguments as Record<string, unknown>;
  }
  return { id, name, arguments: args };
}

export class ToolRegistry {
  private tools = new Map<string, ToolFunction>();

  registerFromOpenAI(tools: OpenAIToolDef[]): void {
    for (const t of tools) {
      const fn = t.function || (t as unknown as ToolFunction);
      if (fn.name) {
        this.tools.set(fn.name, {
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters,
        });
      }
    }
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolFunction | undefined {
    return this.tools.get(name);
  }

  validateArgs(name: string, args: Record<string, unknown>): ValidationResult {
    const tool = this.tools.get(name);
    if (!tool) return { valid: false, errors: [`Unknown tool: ${name}`] };

    const params = tool.parameters;
    if (!params || typeof params !== 'object') return { valid: true };

    const required = (params as Record<string, unknown>).required;
    if (Array.isArray(required)) {
      const missing = required.filter((r: string) => !(r in args));
      if (missing.length > 0) {
        return { valid: false, errors: missing.map((m: string) => `Missing required argument: ${m}`) };
      }
    }

    return { valid: true };
  }

  toCompactDefinitions(): CompactToolDef[] {
    const defs: CompactToolDef[] = [];
    for (const fn of this.tools.values()) {
      defs.push({
        name: fn.name,
        ...(fn.description ? { description: fn.description } : {}),
        ...(fn.parameters ? { parameters: fn.parameters } : {}),
      });
    }
    return defs;
  }
}
