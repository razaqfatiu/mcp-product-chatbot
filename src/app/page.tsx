/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useRef, useState } from 'react';
import type { ConversationState } from '@/lib/agents/shared';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

function mapStateToMessages(state?: ConversationState | null): ChatMessage[] {
  if (!state || !state.messages) {
    return [];
  }

  return state.messages.map((m, index) => ({
    id: `${state.id}-${index}`,
    role: m.role,
    content: m.content,
  }));
}

export default function Home() {
  const [input, setInput] = useState('');
  const [state, setState] = useState<ConversationState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const messages = mapStateToMessages(state).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmed,
          state,
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as {
        reply: string;
        state: ConversationState;
      };

      setState(data.state);
      setInput('');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void sendMessage();
  }

  return (
    <main className="chat-page">
      <div className="chat-shell">
        <header className="chat-header">
          <div className="chat-title">
            <span className="chat-title-pill">MCP</span>
            <h1>MCP Product Chatbot</h1>
          </div>
          <p className="chat-subtitle">
            Ask about products or orders. The orchestrator routes your request
            and calls MCP tools safely on your behalf.
          </p>
        </header>

        <section className="chat-window">
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="chat-empty-title">
                How can I help with your products or orders?
              </p>
              <p className="chat-empty-hint">
                Try asking: <span>“Show me all monitors in stock.”</span> or{' '}
                <span>“What’s the status of my last order?”</span>
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`chat-message chat-message--${message.role}`}
            >
              <div className="chat-avatar">
                {message.role === 'assistant' ? '🤖' : '🙂'}
              </div>
              <div className="chat-bubble">
                <p>{message.content}</p>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="chat-message chat-message--assistant">
              <div className="chat-avatar">🤖</div>
              <div className="chat-bubble chat-bubble--typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </section>

        <footer className="chat-footer">
          {error && <div className="chat-error">{error}</div>}
          <form className="chat-form" onSubmit={handleSubmit}>
            <input
              className="chat-input"
              placeholder="Ask about a product or an order..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={isLoading}
            />
            <button
              type="submit"
              className="chat-send"
              disabled={isLoading || !input.trim()}
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </form>
          <p className="chat-footer-note">
            Powered by a routed orchestrator, LangChain, MCP tools, and
            OpenRouter.
          </p>
        </footer>
      </div>
    </main>
  );
}

