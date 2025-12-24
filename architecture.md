flowchart TB
%% Client entry
U[Client UI / API] -->|User message| O[Orchestrator Agent]

%% Orchestrator internals
subgraph ORCH[Orchestrator Responsibilities]
O --> R[Intent Router\n(Product vs Order + Confidence)]
O --> Q[Clarify Missing Intents\n(ask 1 question at a time)]
O --> S[(Shared Conversation State)]
O --> G[Tool-Call Guardrails\n(intent validated + schema/required params)]
O --> F[Failover Policy\nPrimary->Secondary only on:\ntimeout/5xx/empty tool output]
end

%% Models via OpenRouter
subgraph LLM[LLMs via OpenRouter]
P[Primary Model]
B[Secondary Model]
end
O -->|normal calls| P
O -->|failover calls| B

%% Specialist agents (no direct tools)
R -->|handoff| PA[Product Agent\n(plan tools/resources)]
R -->|handoff| OA[Order Agent\n(plan tools/resources)]

PA -->|tool plan + draft answer| O
OA -->|tool plan + draft answer| O

%% MCP access (only orchestrator executes)
O -->|exec tool calls| MCP[MCP Client]

subgraph TOOLS[MCP Server Tools]
T1[Products:\nlist_products, search_products,\nget_product]
T2[Customers:\nget_customer, verify_customer_pin]
T3[Orders:\nlist_orders, get_order, create_order]
end
MCP --> T1
MCP --> T2
MCP --> T3
TOOLS --> MCP
MCP --> O

%% Refusal templates
O --> D[Deterministic Refusal Templates\n1) Out of scope\n2) Missing auth\n3) Action not supported\n4) Insufficient info\n5) Policy restriction\n6) Tool unavailable]
D -->|when triggered| U

%% Final response
O -->|Final answer| U

%% Observability
subgraph OBS[Langfuse Observability]
L[Langfuse\nStructured Spans:\n- intent classification\n- tool selection\n- tool execution\n- model calls\n- final answer\n+ latency/errors]
end
O -.-> L
PA -.-> L
OA -.-> L
MCP -.-> L
