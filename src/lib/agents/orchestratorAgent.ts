import { randomUUID } from 'crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { McpClient } from '@/mcp/client';
import type {
  McpToolName,
  McpToolSchemaMap,
  McpToolCallResponse,
} from '@/mcp/schemas';
import {
  ProductAgent,
} from './productAgent';
import {
  OrderAgent,
} from './orderAgent';
import {
  type AgentToolPlan,
  type ConversationState,
  type IntentClassification,
  type RefusalCategory,
  REFUSAL_TEMPLATES,
  validateToolPlan,
} from './shared';
import { createTrace, withSpan } from '../langfuse';

export interface OrchestratorConfig {
  primaryModel: BaseChatModel;
  secondaryModel: BaseChatModel;
  mcpClient?: McpClient;
}

export interface OrchestratorResult {
  reply: string;
  state: ConversationState;
}

export class OrchestratorAgent {
  private readonly primaryModel: BaseChatModel;
  private readonly secondaryModel: BaseChatModel;
  private readonly mcpClient: McpClient;
  private readonly productAgent: ProductAgent;
  private readonly orderAgent: OrderAgent;

  constructor(config: OrchestratorConfig) {
    this.primaryModel = config.primaryModel;
    this.secondaryModel = config.secondaryModel;
    this.mcpClient = config.mcpClient ?? new McpClient();
    this.productAgent = new ProductAgent();
    this.orderAgent = new OrderAgent();
  }

  async handleUserMessage(
    userMessage: string,
    state?: ConversationState,
    options?: { userId?: string },
  ): Promise<OrchestratorResult> {
    const nextState: ConversationState =
      state ??
      ({
        id: randomUUID(),
        messages: [],
      } as ConversationState);

    nextState.messages.push({ role: 'user', content: userMessage });

    const trace = createTrace('mcp-orchestrator-chat', {
      userId: options?.userId,
      sessionId: nextState.id,
      metadata: { source: 'orchestrator' },
    });

    const intent = await withSpan(
      trace,
      'intent_classification',
      async () => this.classifyIntent(userMessage),
      { agent: 'orchestrator' },
    );

    const normalized = userMessage.toLowerCase();

    if (intent.targetAgent === 'product') {
      const mentionsMonitors =
        normalized.includes('monitor') || normalized.includes('monitors');
      const looksLikeListing =
        normalized.includes('show me all') ||
        normalized.includes('list') ||
        normalized.includes('browse') ||
        normalized.includes('in stock') ||
        normalized.includes('available');

      if (mentionsMonitors && looksLikeListing) {
        intent.toolHint = 'list_products';
      }
    }

    nextState.lastIntent = intent;

    if (intent.targetAgent === 'out_of_scope') {
      const reply = REFUSAL_TEMPLATES.OUT_OF_SCOPE;
      nextState.messages.push({ role: 'assistant', content: reply });
      if (trace && typeof trace.end === 'function') {
        trace.end({ output: reply });
      }
      return { reply, state: nextState };
    }

    if (intent.missingInformation && intent.targetAgent !== 'order') {
      const reply = intent.missingInformation;
      nextState.messages.push({ role: 'assistant', content: reply });
      if (trace && typeof trace.end === 'function') {
        trace.end({ output: reply });
      }
      return { reply, state: nextState };
    }

    const planResult = await withSpan(
      trace,
      'tool_selection',
      async () => {
        if (intent.targetAgent === 'product') {
          return this.productAgent.plan(userMessage, nextState);
        }
        return this.orderAgent.plan(userMessage, nextState);
      },
      { agent: intent.targetAgent },
    );

    if (planResult.type === 'refusal') {
      if (planResult.pendingCreateOrderArgs) {
        nextState.pendingCreateOrder = planResult.pendingCreateOrderArgs;
      }
      if (planResult.pendingOrderRequestMessage) {
        nextState.pendingOrderRequestMessage =
          planResult.pendingOrderRequestMessage;
        nextState.pendingOrderToolHint =
          planResult.pendingOrderToolHint ?? intent.toolHint ?? null;
      }

      const refusalMessage =
        planResult.message ?? this.templateForCategory(planResult.category);
      nextState.messages.push({ role: 'assistant', content: refusalMessage });
      if (trace && typeof trace.end === 'function') {
        trace.end({ output: refusalMessage });
      }
      return { reply: refusalMessage, state: nextState };
    }

    const validation = validateToolPlan(intent, planResult, nextState);
    if (!validation.ok) {
      const reply =
        validation.category === 'INSUFFICIENT_INFORMATION'
          ? validation.reason
          : this.templateForCategory(validation.category);
      nextState.messages.push({ role: 'assistant', content: reply });
      if (trace && typeof trace.end === 'function') {
        trace.end({ output: reply });
      }
      return { reply, state: nextState };
    }

    const toolResponses = await withSpan(
      trace,
      'tool_execution',
      async () => this.executeToolPlan(planResult, nextState),
      { agent: 'orchestrator' },
    );

    const anyToolError = toolResponses.some(
      (response) => response.isError === true,
    );

    if (anyToolError) {
      const reply = REFUSAL_TEMPLATES.TOOL_UNAVAILABLE;
      nextState.messages.push({ role: 'assistant', content: reply });
      if (trace && typeof trace.end === 'function') {
        trace.end({ output: reply });
      }
      return { reply, state: nextState };
    }

    const usedPendingOrderRequest =
      Boolean(nextState.pendingOrderRequestMessage) &&
      planResult.toolCalls.some((call) => call.tool === 'verify_customer_pin');

    const userMessageForAnswer = usedPendingOrderRequest
      ? nextState.pendingOrderRequestMessage ?? userMessage
      : userMessage;

    if (planResult.toolCalls.some((call) => call.tool === 'create_order')) {
      nextState.pendingCreateOrder = undefined;
    }
    if (usedPendingOrderRequest) {
      nextState.pendingOrderRequestMessage = undefined;
      nextState.pendingOrderToolHint = undefined;
    }

    const reply = await withSpan(
      trace,
      'final_answer',
      async () =>
        this.generateFinalAnswer(userMessageForAnswer, planResult, toolResponses),
      { agent: 'orchestrator' },
    );

    nextState.messages.push({ role: 'assistant', content: reply });
    if (trace && typeof trace.end === 'function') {
      trace.end({ output: reply });
    }

    return { reply, state: nextState };
  }

  private async classifyIntent(
    userMessage: string,
  ): Promise<IntentClassification> {
    const prompt = [
      'You are an orchestrator that routes customer-support queries.',
      'Classify the user request into one of three buckets:',
      '- "product": anything about browsing, searching, or understanding products.',
      '- "order": anything about orders, customers, or account-specific details.',
      '- "out_of_scope": anything else.',
      '',
      'Also determine:',
      '- whether there is missing information that the user must provide before continuing. If something is missing, set "missing_information" to a short follow-up question you want to ask the user. If nothing is missing, set it to null,',
      '- which single MCP tool is most appropriate for this request, if any.',
      '',
      'Available tools:',
      '- For product requests: "list_products", "get_product", "search_products".',
      '- For order requests: "verify_customer_pin", "list_orders", "get_order", "create_order".',
      '',
      'Respond ONLY with a single JSON object with this shape:',
      '{',
      '  "target_agent": "product" | "order" | "out_of_scope",',
      '  "tool_hint": "list_products" | "get_product" | "search_products" | "verify_customer_pin" | "list_orders" | "get_order" | "create_order" | null,',
      '  "missing_information": string | null,',
      '  "reason": string',
      '}',
      '',
      'Rules:',
      '- If target_agent is "out_of_scope", set "tool_hint" to null.',
      '- If the request is about products, choose one of the product tools.',
      '- If the request is specifically about verifying a customer with email + PIN, choose "verify_customer_pin".',
      '- If the request is about orders (history, specific order, new order), choose one of the order tools.',
      '',
      'User request:',
      `"""${userMessage}"""`,
    ].join('\n');

    const modelResponse = await this.runModelWithFailover(prompt);
    const text = this.extractModelContent(modelResponse);

    try {
      const parsed = JSON.parse(text) as {
        target_agent?: string;
        tool_hint?: McpToolName | null;
        missing_information?: string | null;
        reason?: string;
      };

      const targetAgent =
        parsed.target_agent === 'product' ||
        parsed.target_agent === 'order' ||
        parsed.target_agent === 'out_of_scope'
          ? parsed.target_agent
          : 'out_of_scope';

      const validTools: McpToolName[] = [
        'list_products',
        'get_product',
        'search_products',
        'verify_customer_pin',
        'list_orders',
        'get_order',
        'create_order',
      ];

      const toolHint =
        parsed.tool_hint && validTools.includes(parsed.tool_hint)
          ? parsed.tool_hint
          : null;

      const classification: IntentClassification = {
        targetAgent,
        missingInformation:
          parsed.missing_information === undefined
            ? null
            : parsed.missing_information,
        reason: parsed.reason,
        toolHint,
      };

      return classification;
    } catch {
      const fallback: IntentClassification = {
        targetAgent: 'out_of_scope',
        missingInformation: null,
        reason: 'Failed to parse model output as JSON.',
        toolHint: null,
      };
      return fallback;
    }
  }

  private async executeToolPlan(
    plan: AgentToolPlan,
    state: ConversationState,
  ): Promise<McpToolCallResponse<unknown>[]> {
    const responses: McpToolCallResponse<unknown>[] = [];

    for (const call of plan.toolCalls) {
      const response = await this.mcpClient.callTool(call.tool, call.args);
      const typedResponse = response as McpToolCallResponse<unknown>;
      responses.push(typedResponse);

      if (call.tool === 'verify_customer_pin') {
        if (typedResponse.isError) {
          break;
        }

        const args = call.args as {
          email?: string;
          pin?: string;
        };

        if (args.email) {
          state.customerEmail = args.email;
        }
        if (args.pin) {
          state.customerPin = args.pin;
        }

        const text =
          typedResponse.structuredContent &&
          typeof typedResponse.structuredContent === 'object' &&
          'result' in typedResponse.structuredContent
            ? String(
                (typedResponse.structuredContent as { result?: unknown })
                  .result ?? '',
              )
            : typedResponse.content.map((c) => c.text).join('\n');

        const customerIdMatch =
          text.match(
            /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/,
          ) ?? [];

        if (customerIdMatch[0]) {
          state.customerId = customerIdMatch[0];

          if (state.pendingCreateOrder) {
            state.pendingCreateOrder = {
              ...state.pendingCreateOrder,
              customer_id: state.customerId,
            };
          }
        }

        continue;
      }
    }

    return responses;
  }

  private async generateFinalAnswer(
    userMessage: string,
    plan: AgentToolPlan,
    toolResponses: McpToolCallResponse<unknown>[],
  ): Promise<string> {
    const toolSummaries = toolResponses
      .map((response, index) => {
        const toolName: McpToolName = plan.toolCalls[index]?.tool;

        const contentText =
          response.structuredContent && typeof response.structuredContent === 'object' && 'result' in response.structuredContent
            ? String(
                (response.structuredContent as { result?: unknown }).result ??
                  '',
              )
            : response.content.map((c) => c.text).join('\n');

        const maybeLimitedContent =
          toolName === 'list_products' || toolName === 'search_products'
            ? this.limitProductList(contentText)
            : contentText;

        return `Tool ${index + 1} (${toolName}):\n${maybeLimitedContent}`;
      })
      .join('\n\n');

    const prompt = [
      'You are a customer-support assistant for products and orders.',
      'Use the provided tool results to answer the user clearly and concisely.',
      'Do not invent products, orders, or details that are not present in the tool outputs.',
      '',
      'User request:',
      `"""${userMessage}"""`,
      '',
      'Tool results:',
      `"""`,
      toolSummaries,
      `"""`,
      '',
      'Answer the user in natural language, referencing specific products or orders where appropriate.',
    ].join('\n');

    const modelResponse = await this.runModelWithFailover(prompt);
    const text = this.extractModelContent(modelResponse);
    return text;
  }

  private async runModelWithFailover(input: string): Promise<unknown> {
    try {
      const primaryResult = await this.primaryModel.invoke(input);
      const content = this.extractModelContent(primaryResult);
      if (!content || !String(content).trim()) {
        throw new Error('Empty response from primary model.');
      }
      return primaryResult;
    } catch {
      const secondaryResult = await this.secondaryModel.invoke(input);
      return secondaryResult;
    }
  }

  private extractModelContent(modelResult: unknown): string {
    if (typeof modelResult === 'string') {
      return modelResult;
    }

    const result = modelResult as {
      content?: unknown;
    };

    if (typeof result.content === 'string') {
      return result.content;
    }

    if (Array.isArray(result.content)) {
      const parts = result.content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text?: unknown }).text ?? '');
          }
          return '';
        })
        .filter(Boolean);
      return parts.join('\n');
    }

    return JSON.stringify(result);
  }

  private limitProductList(raw: string): string {
    const defaultLimit = 20;
    const envLimit = process.env.PRODUCT_LIST_MAX_ITEMS;
    const limit = envLimit ? Number.parseInt(envLimit, 10) : defaultLimit;

    if (!Number.isFinite(limit) || limit <= 0) {
      return raw;
    }

    const blocks = raw.split(/\n\s*\n/);

    if (blocks.length <= limit + 1) {
      return raw;
    }

    const header = blocks[0];
    const items = blocks.slice(1, 1 + limit);
    const truncated = [header, ...items].join('\n\n');

    return `${truncated}\n\n(Showing first ${limit} products; additional items are omitted.)`;
  }

  private templateForCategory(category: RefusalCategory): string {
    return REFUSAL_TEMPLATES[category];
  }
}
