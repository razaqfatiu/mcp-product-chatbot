import type {
  AgentPlanResult,
  AgentToolPlan,
  ToolCallPlan,
} from './shared';
import type { ConversationState } from './shared';
import type { McpToolName } from '@/mcp/schemas';

export class ProductAgent {
  readonly kind = 'product' as const;

  async plan(
    userMessage: string,
    state: ConversationState,
  ): Promise<AgentPlanResult> {
    const intent = state.lastIntent;
    const normalized = userMessage.toLowerCase();
    const wantsInStock =
      normalized.includes('in stock') || normalized.includes('available');
    const toolCalls: ToolCallPlan<McpToolName>[] = [];

    const skuMatch = userMessage.match(/\b[A-Z]{3}-\d{4}\b/);

    if (intent?.toolHint === 'get_product') {
      if (!skuMatch) {
        const plan: AgentToolPlan = {
          type: 'tool_plan',
          targetAgent: 'product',
          toolCalls: [
            {
              tool: 'search_products',
              args: { query: userMessage },
              description:
                'Fallback to search when SKU was requested but not provided.',
            },
          ],
        };
        return plan;
      }

      toolCalls.push({
        tool: 'get_product',
        args: { sku: skuMatch[0] },
        description: 'Get product details by SKU.',
      });
    } else if (intent?.toolHint === 'list_products') {
      let category: string | undefined;

      if (normalized.includes('monitor')) {
        category = 'Monitors';
      } else if (
        normalized.includes('computer') ||
        normalized.includes('laptop') ||
        normalized.includes('pc')
      ) {
        category = 'Computers';
      } else if (
        normalized.includes('network') ||
        normalized.includes('router') ||
        normalized.includes('switch') ||
        normalized.includes('modem')
      ) {
        category = 'Networking';
      }

      const args: { category?: string | null; is_active?: boolean | null } = {};
      if (category) {
        args.category = category;
      }
      if (wantsInStock) {
        args.is_active = true;
      }

      toolCalls.push({
        tool: 'list_products',
        args,
        description:
          'List products filtered by inferred category and availability.',
      });
    } else if (intent?.toolHint === 'search_products') {
      toolCalls.push({
        tool: 'search_products',
        args: { query: userMessage },
        description: 'Search products by query text.',
      });
    } else {
      if (skuMatch) {
        toolCalls.push({
          tool: 'get_product',
          args: { sku: skuMatch[0] },
          description: 'Get product details by SKU.',
        });
      } else {
        let category: string | undefined;

        if (normalized.includes('monitor')) {
          category = 'Monitors';
        } else if (
          normalized.includes('computer') ||
          normalized.includes('laptop') ||
          normalized.includes('pc')
        ) {
          category = 'Computers';
        } else if (
          normalized.includes('network') ||
          normalized.includes('router') ||
          normalized.includes('switch') ||
          normalized.includes('modem')
        ) {
          category = 'Networking';
        }

        if (category) {
          const args: {
            category?: string | null;
            is_active?: boolean | null;
          } = {
            category,
          };
          if (wantsInStock) {
            args.is_active = true;
          }

          toolCalls.push({
            tool: 'list_products',
            args,
            description:
              'List products filtered by inferred category and availability.',
          });
        } else if (
          normalized.includes('list') ||
          normalized.includes('all products') ||
          normalized.includes('browse')
        ) {
          const args: {
            category?: string | null;
            is_active?: boolean | null;
          } = {};
          if (wantsInStock) {
            args.is_active = true;
          }

          toolCalls.push({
            tool: 'list_products',
            args,
            description: 'List products matching optional filters.',
          });
        } else {
          toolCalls.push({
            tool: 'search_products',
            args: { query: userMessage },
            description: 'Search products by query text.',
          });
        }
      }
    }

    const plan: AgentToolPlan = {
      type: 'tool_plan',
      targetAgent: 'product',
      toolCalls,
    };

    return plan;
  }
}
