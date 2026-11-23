export type Audience = readonly string[];
declare const protectedValue: unique symbol;
export interface Protected<T = unknown> { readonly id: string; readonly [protectedValue]: T }
export interface Completion {
  id?: string;
  model?: string;
  choices: Array<{ index: number; message: { role: string; content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; [key: string]: unknown };
}
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Provider {
  complete(request: { messages: Array<Record<string, unknown>>; parameters: Record<string, unknown>; signal: AbortSignal }): Promise<Completion>;
}
export interface Tool {
  execute(args: any, context: { signal?: AbortSignal }): Promise<unknown>;
  outputAllow?: Audience;
}
export interface Message {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: Protected<string | null>;
  toolCalls?: Protected<ToolCall[]>;
  tool_call_id?: string;
}
export interface Receipt {
  version: 1;
  eventCount: number;
  events: ReadonlyArray<Readonly<{ seq: number; type: string; [key: string]: unknown }>>;
}
export class Boundary {
  constructor(options?: { providers?: Record<string, Provider>; tools?: Record<string, Tool | Tool['execute']>; maxEvents?: number });
  data<T>(content: T, policy?: { allow?: Audience }): Protected<T>;
  derive<T extends unknown[], R>(handles: { [K in keyof T]: Protected<T[K]> }, transform: (...values: T) => R): Protected<R>;
  restrict<T>(value: Protected<T>, allow: Audience): Protected<T>;
  release<T>(value: Protected<T>, approval: { allow: Audience; approvalId: string }): Protected<T>;
  reveal<T>(value: Protected<T>): T;
  policy(value: Protected): Readonly<{ allow: Audience; sources: readonly string[] }>;
  revoke(destination: string): void;
  receipt(): Receipt;
  complete(request: { messages: Message[]; routes: string[]; parameters?: Record<string, unknown>; retries?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<{ readonly value: Protected<Completion>; readonly destination: string; readonly attempts: number }>;
  invoke(destination: string, args: Protected, options?: { signal?: AbortSignal }): Promise<Protected>;
}
export class BoundaryError extends Error {
  code: string; retryable: boolean; status: number;
  constructor(code: string, message: string, options?: { retryable?: boolean; status?: number });
}
export function openAICompatible(options: { baseURL: string; model: string; apiKey?: string | (() => string | undefined); maxResponseBytes?: number; stream?: boolean }): Provider;
