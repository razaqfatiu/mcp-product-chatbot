import type {
  McpToolName,
  McpToolSchemaMap,
  CreateOrderArgs,
} from '@/mcp/schemas';

export type AgentKind = 'product' | 'order';

export type RefusalCategory =
  | 'OUT_OF_SCOPE'
  | 'MISSING_AUTH'
  | 'ACTION_NOT_SUPPORTED'
  | 'INSUFFICIENT_INFORMATION'
  | 'POLICY_RESTRICTION'
  | 'TOOL_UNAVAILABLE';

export const REFUSAL_TEMPLATES: Record<RefusalCategory, string> = {
  OUT_OF_SCOPE:
    "Sorry, I can't help with that request. I can assist with products or orders.",
  MISSING_AUTH:
    "I can help once you provide your customer ID and PIN.",
  ACTION_NOT_SUPPORTED:
    "That action isn't supported yet. I can help with available order details.",
  INSUFFICIENT_INFORMATION:
    'I need a bit more information to continue.',
  POLICY_RESTRICTION:
    "I'm unable to help with that request due to policy restrictions.",
  TOOL_UNAVAILABLE:
    "I'm unable to complete that right now because the tools I use are unavailable or failing. Please try again later.",
};

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface IntentClassification {
  targetAgent: AgentKind | 'out_of_scope';
  missingInformation?: string | null;
  reason?: string;
  toolHint?: McpToolName | null;
}

export interface ConversationState {
  id: string;
  messages: ConversationMessage[];
  lastIntent?: IntentClassification;
  customerEmail?: string;
  customerPin?: string;
  pendingCreateOrder?: CreateOrderArgs;
   pendingOrderRequestMessage?: string;
   pendingOrderToolHint?: McpToolName | null;
}

export const PRODUCT_TOOLS: McpToolName[] = [
  'list_products',
  'get_product',
  'search_products',
];

export const ORDER_TOOLS: McpToolName[] = [
  'get_customer',
  'verify_customer_pin',
  'list_orders',
  'get_order',
  'create_order',
];

export type ToolCallPlan<TName extends McpToolName = McpToolName> = {
  tool: TName;
  args: McpToolSchemaMap[TName]['input'];
  description?: string;
};

export interface AgentToolPlan {
  type: 'tool_plan';
  targetAgent: AgentKind;
  toolCalls: ToolCallPlan[];
}

export interface AgentRefusal {
  type: 'refusal';
  category: RefusalCategory;
  message?: string;
  pendingCreateOrderArgs?: CreateOrderArgs;
  pendingOrderRequestMessage?: string;
  pendingOrderToolHint?: McpToolName | null;
}

export type AgentPlanResult = AgentToolPlan | AgentRefusal;

export interface ToolPlanValidationSuccess {
  ok: true;
}

export interface ToolPlanValidationFailure {
  ok: false;
  category: RefusalCategory;
  reason: string;
}

export type ToolPlanValidationResult =
  | ToolPlanValidationSuccess
  | ToolPlanValidationFailure;

export function validateToolPlan(
  intent: IntentClassification,
  plan: AgentToolPlan,
  _state: ConversationState,
): ToolPlanValidationResult {
  if (intent.targetAgent === 'out_of_scope') {
    return {
      ok: false,
      category: 'OUT_OF_SCOPE',
      reason: 'Intent is out of scope.',
    };
  }

  const allowedTools =
    plan.targetAgent === 'product' ? PRODUCT_TOOLS : ORDER_TOOLS;

  for (const call of plan.toolCalls) {
    if (!allowedTools.includes(call.tool)) {
      return {
        ok: false,
        category: 'ACTION_NOT_SUPPORTED',
        reason: `Tool ${call.tool} is not allowed for ${plan.targetAgent} agent.`,
      };
    }

    const args: Record<string, unknown> = call.args as Record<string, unknown>;

    switch (call.tool) {
      case 'get_product': {
        if (!args.sku || typeof args.sku !== 'string') {
          return {
            ok: false,
            category: 'INSUFFICIENT_INFORMATION',
            reason: 'Please provide the product SKU so I can look it up.',
          };
        }
        break;
      }
      case 'search_products': {
        if (!args.query || typeof args.query !== 'string') {
          return {
            ok: false,
            category: 'INSUFFICIENT_INFORMATION',
            reason:
              'What keywords should I use to search for the product?',
          };
        }
        break;
      }
      case 'get_order': {
        if (!args.order_id || typeof args.order_id !== 'string') {
          return {
            ok: false,
            category: 'INSUFFICIENT_INFORMATION',
            reason:
              'Please provide the order ID (UUID) so I can get that order.',
          };
        }
        break;
      }
      case 'create_order': {
        break;
      }
      case 'get_customer':
      case 'verify_customer_pin':
      case 'list_products':
      default:
        break;
    }
  }

  return { ok: true };
}
