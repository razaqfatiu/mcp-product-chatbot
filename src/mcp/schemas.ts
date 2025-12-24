export const MCP_SERVER_URL =
  "https://vipfapwm3x.us-east-1.awsapprunner.com/mcp";

export type McpToolName =
  | "list_products"
  | "get_product"
  | "search_products"
  | "get_customer"
  | "verify_customer_pin"
  | "list_orders"
  | "get_order"
  | "create_order";

export type McpTextContent = {
  type: "text";
  text: string;
};

export type McpToolCallResponse<TStructured> = {
  content: McpTextContent[];
  structuredContent?: TStructured;
  isError: boolean;
};

export type ListProductsArgs = {
  category?: string | null;
  is_active?: boolean | null;
};

export type ListProductsResult = {
  result: string;
};

export type ListProductsResponse = McpToolCallResponse<ListProductsResult>;

export type GetProductArgs = {
  sku: string;
};

export type GetProductResult = {
  result: string;
};

export type GetProductResponse = McpToolCallResponse<GetProductResult>;

export type SearchProductsArgs = {
  query: string;
};

export type SearchProductsResult = {
  result: string;
};

export type SearchProductsResponse = McpToolCallResponse<SearchProductsResult>;

export type GetCustomerArgs = {
  customer_id: string;
};

export type GetCustomerResult = {
  result: string;
};

export type GetCustomerResponse = McpToolCallResponse<GetCustomerResult>;

export type VerifyCustomerPinArgs = {
  email: string;
  pin: string;
};

export type VerifyCustomerPinResult = {
  result: string;
};

export type VerifyCustomerPinResponse =
  McpToolCallResponse<VerifyCustomerPinResult>;

export type ListOrdersArgs = {
  customer_id?: string | null;
  status?: string | null;
};

export type ListOrdersResult = {
  result: string;
};

export type ListOrdersResponse = McpToolCallResponse<ListOrdersResult>;

export type GetOrderArgs = {
  order_id: string;
};

export type GetOrderResult = {
  result: string;
};

export type GetOrderResponse = McpToolCallResponse<GetOrderResult>;

export type CreateOrderItem = {
  sku: string;
  quantity: number;
  unit_price: string;
  currency?: string;
};

export type CreateOrderArgs = {
  customer_id: string;
  items: CreateOrderItem[];
};

export type CreateOrderResult = {
  result: string;
};

export type CreateOrderResponse = McpToolCallResponse<CreateOrderResult>;

export interface McpToolSchemaMap {
  list_products: {
    input: ListProductsArgs;
    output: ListProductsResult;
    response: ListProductsResponse;
  };
  get_product: {
    input: GetProductArgs;
    output: GetProductResult;
    response: GetProductResponse;
  };
  search_products: {
    input: SearchProductsArgs;
    output: SearchProductsResult;
    response: SearchProductsResponse;
  };
  get_customer: {
    input: GetCustomerArgs;
    output: GetCustomerResult;
    response: GetCustomerResponse;
  };
  verify_customer_pin: {
    input: VerifyCustomerPinArgs;
    output: VerifyCustomerPinResult;
    response: VerifyCustomerPinResponse;
  };
  list_orders: {
    input: ListOrdersArgs;
    output: ListOrdersResult;
    response: ListOrdersResponse;
  };
  get_order: {
    input: GetOrderArgs;
    output: GetOrderResult;
    response: GetOrderResponse;
  };
  create_order: {
    input: CreateOrderArgs;
    output: CreateOrderResult;
    response: CreateOrderResponse;
  };
}
