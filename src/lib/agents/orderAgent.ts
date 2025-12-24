import type {
  AgentPlanResult,
  AgentRefusal,
  AgentToolPlan,
  ToolCallPlan,
} from './shared';
import {
  REFUSAL_TEMPLATES,
} from './shared';
import type { ConversationState } from './shared';
import type { McpToolName } from '@/mcp/schemas';

export class OrderAgent {
  readonly kind = 'order' as const;

  async plan(
    userMessage: string,
    state: ConversationState,
  ): Promise<AgentPlanResult> {
    const intent = state.lastIntent;
    const toolCalls: ToolCallPlan<McpToolName>[] = [];

    if (intent?.toolHint === 'verify_customer_pin') {
      const emailMatch = userMessage.match(/[^\s]+@[^\s]+/);
      const pinMatch = userMessage.match(/\b\d{4}\b/);

      if (!emailMatch || !pinMatch) {
        const refusal: AgentRefusal = {
          type: 'refusal',
          category: 'INSUFFICIENT_INFORMATION',
          message:
            `${REFUSAL_TEMPLATES.INSUFFICIENT_INFORMATION} Please provide your customer email and 4-digit PIN so I can verify you.`,
        };
        return refusal;
      }

      toolCalls.push({
        tool: 'verify_customer_pin',
        args: {
          email: emailMatch[0],
          pin: pinMatch[0],
        },
        description: 'Verify customer identity using email and PIN.',
      });

      if (state.pendingCreateOrder) {
        toolCalls.push({
          tool: 'create_order',
          args: state.pendingCreateOrder,
          description:
            'Create a new order using the previously provided customer_id and items after successful verification.',
        });
      }
    } else if (intent?.toolHint === 'create_order') {
      const jsonMatch = userMessage.match(/{[\s\S]+}/);

      if (jsonMatch) {
        try {
          const payload = JSON.parse(jsonMatch[0]) as {
            customer_id?: string;
            items?: Array<{
              sku?: string;
              quantity?: number;
              unit_price?: string;
              currency?: string;
            }>;
          };

          if (!payload.customer_id || !Array.isArray(payload.items)) {
            throw new Error('Missing customer_id or items');
          }

          const cleanedItems = payload.items
            .filter(
              (item) =>
                typeof item.sku === 'string' &&
                typeof item.quantity === 'number' &&
                typeof item.unit_price === 'string',
            )
            .map((item) => ({
              sku: item.sku as string,
              quantity: item.quantity as number,
              unit_price: item.unit_price as string,
              currency: item.currency ?? 'USD',
            }));

          if (cleanedItems.length === 0) {
            throw new Error('No valid items after validation');
          }

          const refusal: AgentRefusal = {
            type: 'refusal',
            category: 'INSUFFICIENT_INFORMATION',
            message:
              `${REFUSAL_TEMPLATES.INSUFFICIENT_INFORMATION} Please provide your customer email and 4-digit PIN so I can verify you before creating the order.`,
            pendingCreateOrderArgs: {
              customer_id: payload.customer_id,
              items: cleanedItems,
            },
          };
          return refusal;
        } catch {
          const refusal: AgentRefusal = {
            type: 'refusal',
            category: 'INSUFFICIENT_INFORMATION',
            message:
              `${REFUSAL_TEMPLATES.INSUFFICIENT_INFORMATION} Please provide a valid JSON payload with customer_id and items (sku, quantity, unit_price, currency).`,
          };
          return refusal;
        }
      } else {
        const refusal: AgentRefusal = {
          type: 'refusal',
          category: 'INSUFFICIENT_INFORMATION',
          message:
            `${REFUSAL_TEMPLATES.INSUFFICIENT_INFORMATION} Please include a JSON payload with customer_id and items (sku, quantity, unit_price, currency).`,
        };
        return refusal;
      }
    } else if (intent?.toolHint === 'get_order') {
      const uuidMatch =
        userMessage.match(
          /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/,
        );

      if (!uuidMatch?.[0]) {
        const refusal: AgentRefusal = {
          type: 'refusal',
          category: 'INSUFFICIENT_INFORMATION',
          message:
            `${REFUSAL_TEMPLATES.INSUFFICIENT_INFORMATION} Please provide the order ID (UUID) so I can fetch a specific order.`,
        };
        return refusal;
      }

      toolCalls.push({
        tool: 'get_order',
        args: { order_id: uuidMatch[0] },
        description: 'Get a specific order by its ID.',
      });
    } else if (intent?.toolHint === 'list_orders') {
      toolCalls.push({
        tool: 'list_orders',
        args: {},
        description: 'List orders for the customer.',
      });
    } else {
      const uuidMatch =
        userMessage.match(
          /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/,
        );

      if (uuidMatch?.[0]) {
        toolCalls.push({
          tool: 'get_order',
          args: { order_id: uuidMatch[0] },
          description: 'Get a specific order by its ID.',
        });
      } else {
        toolCalls.push({
          tool: 'list_orders',
          args: {},
          description:
            'Default to listing recent orders when order intent is detected.',
        });
      }
    }

    const plan: AgentToolPlan = {
      type: 'tool_plan',
      targetAgent: 'order',
      toolCalls,
    };

    return plan;
  }
}
