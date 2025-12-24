import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { OrchestratorAgent } from '@/lib/agents/orchestratorAgent';
import type { ConversationState } from '@/lib/agents/shared';

function createOpenRouterModel(modelNameEnv: string, fallbackModel: string): BaseChatModel {
  const modelName = process.env[modelNameEnv] ?? fallbackModel;

  const model = new ChatOpenAI({
    modelName,
    temperature: 0,
  } as any);

  return model;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    message: string;
    state?: ConversationState;
    userId?: string;
  };

  const primaryModel = createOpenRouterModel(
    'OPENROUTER_PRIMARY_MODEL',
    'gpt-4o-mini',
  );
  const secondaryModel = createOpenRouterModel(
    'OPENROUTER_SECONDARY_MODEL',
    'gpt-4o',
  );

  const orchestrator = new OrchestratorAgent({
    primaryModel,
    secondaryModel,
  });

  const result = await orchestrator.handleUserMessage(
    body.message,
    body.state,
    { userId: body.userId },
  );

  return NextResponse.json(result);
}
