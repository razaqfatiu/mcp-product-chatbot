# MCP Product Chatbot

Customer-support orchestrator chatbot built with Next.js, TypeScript, LangChain, MCP tools, and OpenRouter.

## Architecture overview

- **Orchestrator agent**: Uses an LLM to classify requests (product vs. order vs. out-of-scope) and suggest a single MCP `toolHint`, enforces guardrails, initializes the MCP client, validates tool plans, executes MCP tools, asks follow-up questions when information is missing, and composes the final answer via LLM with primary/secondary models (failover on explicit failures only).
- **Product agent**: Turns the orchestrator’s `toolHint` into concrete product tool calls (e.g., `list_products`, `get_product`, `search_products`) using lightweight heuristics (category, “in stock”, etc.), without calling MCP directly.
- **Order agent**: Uses the orchestrator’s `toolHint` to decide between `verify_customer_pin`, `list_orders`, `get_order`, and `create_order`. It works with the orchestrator to:
  - Parse and validate order payloads for `create_order`.
  - Guide the user through verification with `verify_customer_pin`.
  - Reuse the verified identity to scope subsequent `list_orders` and `get_order` calls to that customer.
- **Guardrail layer**: Shared validation (`src/lib/agents/shared.ts`) ensures:
  - Tools are domain-correct (product vs. order).
  - Required parameters are present (`sku`, `query`, `order_id`, etc.).
  - Out-of-scope, policy, unsupported-action, or tool-failure cases return deterministic refusal templates (no LLM-generated refusals).
  - Insufficient-information cases return targeted follow-up questions so the user can clarify intent (e.g., “Please provide the product SKU…”).
- **MCP client**: `src/mcp/client.ts` talks to your MCP server (JSON-RPC `tools/call`), using typed schemas from `src/mcp/schemas.ts`.
- **LLMs via OpenRouter**: The orchestrator depends on abstract `BaseChatModel`s; the API route (`src/app/api/chat/route.ts`) wires them to OpenRouter-backed models using `@langchain/openai`.
- **Langfuse observability**: `src/lib/langfuse.ts` provides traces and spans for:
  - intent classification
  - tool selection
  - tool execution
  - final answer
- **UI**: `src/app/page.tsx` is a chat UI that talks to `/api/chat` and preserves `ConversationState` across turns.

## MCP server integration

- MCP server endpoint is configured in `src/mcp/schemas.ts` as `MCP_SERVER_URL` and currently points to your hosted server.
- Tools discovered and modeled include:
  - Products: `list_products`, `get_product`, `search_products`
  - Customers: `get_customer`, `verify_customer_pin`
  - Orders: `list_orders`, `get_order`, `create_order`
- Response types model both success and error shapes:
  - `content`: display text for the user.
  - `structuredContent` (optional): structured result (e.g., `{ result: string }`).
  - `isError`: boolean flag used for guardrails and fallbacks.

## Environment configuration

Copy `.env.sample` to `.env` and fill in your values:

```bash
cp .env.sample .env
```

Environment variables:

- `OPENAI_API_KEY`: your OpenRouter API key (used via `@langchain/openai`).
- `OPENAI_BASE_URL`: should be `https://openrouter.ai/api/v1` for OpenRouter.
- `OPENROUTER_PRIMARY_MODEL`: primary model ID (e.g., `openai/gpt-4.1-mini`).
- `OPENROUTER_SECONDARY_MODEL`: secondary model ID (e.g., `openai/gpt-4o`) used only on explicit failures (timeouts, 5xx, empty outputs).
- `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASE_URL`: Langfuse credentials for tracing (optional but recommended).
- `PRODUCT_LIST_MAX_ITEMS`: maximum number of products to include from MCP `list_products`/`search_products` results (default 20). Longer lists are truncated server-side before being summarized by the LLM.

## Running the app

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser to use the chat UI.

## Chat flow

1. The UI (`/`) sends `{ message, state }` to `POST /api/chat`.
2. The API route builds primary and secondary LangChain chat models (OpenRouter), constructs an `OrchestratorAgent`, and calls `handleUserMessage`.
3. The orchestrator:
   - Classifies intent and decides if it’s product, order, or out-of-scope.
   - Asks follow-up questions when information is missing until it has enough detail to safely choose tools.
   - Applies deterministic refusals for out-of-scope, policy restrictions, unsupported actions, or tool failures.
   - Hands off to the product/order agent to plan tools based on the LLM-provided `toolHint`, then validates that plan and executes approved MCP tools.
   - Summarizes tool outputs via the LLM and returns the final answer.
4. The API returns `{ reply, state }`, which the UI renders and uses as the next `ConversationState`.

### Order creation behaviour

- Order creation is a two-step flow to reduce errors:
  1. **Capture order details**  
     - User provides a JSON payload like:

```json
{
  "customer_id": "customer-uuid",
  "items": [
    { "sku": "MON-0088", "quantity": 2, "unit_price": "626.47", "currency": "USD" }
  ]
}
```

     - The order agent validates and stores this payload on the conversation state (`pendingCreateOrder`) and asks for email + PIN if they are not yet provided.
  2. **Verify, then create**  
     - When the user provides their customer email and 4-digit PIN, the order agent:
       - Calls `verify_customer_pin` to authenticate the customer and stores the verified email, PIN, and customer UUID on the conversation state.
       - If verification succeeds and a `pendingCreateOrder` payload exists, the orchestrator updates its `customer_id` with the verified customer UUID and then calls `create_order` with the stored `items`.
     - If the verification fails, `create_order` is not called and the orchestrator returns a deterministic tool-failure style response.

After a successful verification, the system remembers the customer’s email and PIN for the remainder of the conversation so it does not have to re-ask for them on every order-related turn.
