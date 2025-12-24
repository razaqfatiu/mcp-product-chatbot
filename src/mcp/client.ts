import {
  MCP_SERVER_URL,
  type McpToolName,
  type McpToolSchemaMap,
} from '@/mcp/schemas';

export interface McpClientOptions {
  baseUrl?: string;
}

export class McpClient {
  private readonly baseUrl: string;

  constructor(options?: McpClientOptions) {
    this.baseUrl = options?.baseUrl ?? MCP_SERVER_URL;
  }

  async callTool<TName extends McpToolName>(
    toolName: TName,
    args: McpToolSchemaMap[TName]['input'],
  ): Promise<McpToolSchemaMap[TName]['response']> {
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `MCP request failed with status ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      result?: unknown;
      error?: { code: number; message: string };
    };

    if (json.error) {
      throw new Error(
        `MCP error ${json.error.code}: ${json.error.message ?? 'Unknown error'}`,
      );
    }

    if (!json.result) {
      throw new Error('MCP response did not include a result.');
    }

    return json.result as McpToolSchemaMap[TName]['response'];
  }
}
