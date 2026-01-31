import Conf from 'conf';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

interface Config {
  apiKey?: string;
  defaultModel?: string;
  theme?: string;
  defaultSystemPrompt?: string;
  conversations?: Conversation[];
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  systemPrompt?: string;
  pinned?: boolean;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

class ConfigStore {
  private store: Conf<Config>;

  constructor() {
    this.store = new Conf<Config>({
      projectName: 'openrouter-cli',
      defaults: {
        conversations: []
      }
    });
  }

  getApiKey(): string | undefined {
    // Priority: .env (random from list) > config store
    const envKeys = process.env.OPENROUTER_API_KEYS;
    if (envKeys) {
      const keys = envKeys.split(',').map(k => k.trim()).filter(k => k);
      if (keys.length > 0) {
        // Random pick a key
        return keys[Math.floor(Math.random() * keys.length)];
      }
    }
    return this.store.get('apiKey');
  }

  setApiKey(key: string): void {
    this.store.set('apiKey', key);
  }

  getDefaultModel(): string {
    return this.store.get('defaultModel') || 'openai/gpt-3.5-turbo';
  }

  setDefaultModel(model: string): void {
    this.store.set('defaultModel', model);
  }

  getConversations(): Conversation[] {
    return this.store.get('conversations') || [];
  }

  saveConversation(conversation: Conversation): void {
    const conversations = this.getConversations();
    const index = conversations.findIndex(c => c.id === conversation.id);

    if (index >= 0) {
      conversations[index] = conversation;
    } else {
      conversations.push(conversation);
    }

    this.store.set('conversations', conversations);
  }

  deleteConversation(id: string): void {
    const conversations = this.getConversations();
    this.store.set('conversations', conversations.filter(c => c.id !== id));
  }

  clearConversations(): void {
    this.store.set('conversations', []);
  }

  getTheme(): string {
    return this.store.get('theme') || 'dark';
  }

  setTheme(theme: string): void {
    this.store.set('theme', theme);
  }

  getDefaultSystemPrompt(): string {
    return this.store.get('defaultSystemPrompt') || '';
  }

  setDefaultSystemPrompt(prompt: string): void {
    this.store.set('defaultSystemPrompt', prompt);
  }

  getHistoryEnabled(): boolean {
    return this.store.get('historyEnabled' as any) ?? false;
  }

  setHistoryEnabled(enabled: boolean): void {
    this.store.set('historyEnabled' as any, enabled);
  }

  getHistoryMessageCount(): number {
    return this.store.get('historyMessageCount' as any) ?? 20;
  }

  setHistoryMessageCount(count: number): void {
    this.store.set('historyMessageCount' as any, count);
  }

  // Get recent messages from all conversations for history context
  getRecentMessagesContext(excludeConvId?: string): string {
    const conversations = this.getConversations();
    const count = this.getHistoryMessageCount();

    // Collect all messages from other conversations, sorted by timestamp
    const allMessages: { role: string; content: string; timestamp: number; convTitle: string }[] = [];

    for (const conv of conversations) {
      if (conv.id === excludeConvId) continue;
      for (const msg of conv.messages) {
        allMessages.push({
          role: msg.role,
          content: msg.content.slice(0, 500), // Limit content length
          timestamp: msg.timestamp,
          convTitle: conv.title
        });
      }
    }

    // Sort by timestamp descending and take recent ones
    allMessages.sort((a, b) => b.timestamp - a.timestamp);
    const recent = allMessages.slice(0, count);

    if (recent.length === 0) return '';

    // Format as context string
    return recent.map(m =>
      `[${m.role === 'user' ? 'User' : 'AI'}]: ${m.content}`
    ).reverse().join('\n');
  }

  getAll(): Config {
    return this.store.store;
  }
}

export const configStore = new ConfigStore();
