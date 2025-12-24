import { Langfuse } from 'langfuse';

type LangfuseTrace = any;
type LangfuseSpan = any;

let langfuseClient: Langfuse | null = null;

if (
  process.env.LANGFUSE_SECRET_KEY &&
  process.env.LANGFUSE_PUBLIC_KEY &&
  process.env.LANGFUSE_BASE_URL
) {
  langfuseClient = new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });
}

export function createTrace(
  name: string,
  options?: {
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  },
): LangfuseTrace | null {
  if (!langfuseClient) {
    return null;
  }

  return langfuseClient.trace(
    {
      name,
      userId: options?.userId,
      sessionId: options?.sessionId,
      metadata: options?.metadata,
    },
  );
}

export async function withSpan<T>(
  trace: LangfuseTrace | null,
  name: string,
  fn: (span: LangfuseSpan | null) => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  if (!trace || !langfuseClient) {
    return fn(null);
  }

  const span = trace.span({ name, metadata });

  try {
    const result = await fn(span);
    if (span && typeof span.end === 'function') {
      span.end({ output: result });
    }
    return result;
  } catch (error) {
    if (span && typeof span.setError === 'function') {
      span.setError(error as Error);
    }
    if (span && typeof span.end === 'function') {
      span.end();
    }
    throw error;
  }
}
