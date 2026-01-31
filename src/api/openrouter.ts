import { configStore } from '../config/store';

export interface Model {
  id: string;
  name: string;
  description?: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
}

export interface FreeModel {
  id: string;
  name: string;
  context_length: number;
}

class OpenRouterAPI {
  private baseURL = 'https://openrouter.ai/api/v1';

  async getFreeModels(): Promise<FreeModel[]> {
    try {
      const response = await fetch(
        'https://openrouter.ai/api/frontend/models/find?fmt=cards&input_modalities=text&output_modalities=text&max_price=0',
        {
          headers: {
            'accept': '*/*',
            'user-agent': 'OpenRouter-CLI/1.0'
          }
        }
      );

      if (!response.ok) {
        return [];
      }

      const data: any = await response.json();
      const models: FreeModel[] = [];

      if (data?.data?.models) {
        for (const model of data.data.models) {
          if (model.endpoint?.model_variant_slug) {
            models.push({
              id: model.endpoint.model_variant_slug,
              name: model.short_name || model.name,
              context_length: model.context_length || 0
            });
          }
        }
      }

      return models;
    } catch (error) {
      return [];
    }
  }

  private getHeaders() {
    const apiKey = configStore.getApiKey();
    if (!apiKey) {
      throw new Error('API key chưa được cấu hình. Chạy: openrouter config set-key');
    }

    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/openrouter-cli',
      'X-Title': 'OpenRouter CLI'
    };
  }

  async getModels(): Promise<Model[]> {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: this.getHeaders()
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: any = await response.json();
      return data.data;
    } catch (error: any) {
      throw new Error(`Lỗi khi lấy danh sách models: ${error.message}`);
    }
  }

  async chat(messages: ChatMessage[], model?: string): Promise<ChatCompletionResponse> {
    const selectedModel = model || configStore.getDefaultModel();

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: selectedModel,
          messages
        })
      });

      if (!response.ok) {
        const errorData: any = await response.json();
        throw new Error(errorData.error?.message || response.statusText);
      }

      return await response.json() as ChatCompletionResponse;
    } catch (error: any) {
      throw new Error(`Lỗi khi gọi API: ${error.message}`);
    }
  }

  async *chatStream(messages: ChatMessage[], model?: string): AsyncGenerator<string> {
    const selectedModel = model || configStore.getDefaultModel();

    try {
      const requestBody = {
        model: selectedModel,
        messages,
        stream: true
      };


      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody)
      });


      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        throw new Error(errorData.error?.message || response.statusText);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Không thể đọc response stream');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              chunkCount++;
              yield content;
            }
          } catch (e) {
            // Skip invalid chunks
          }
        }
      }
    } catch (error: any) {
      throw new Error(`Lỗi khi stream: ${error.message}`);
    }
  }
}

export const openRouterAPI = new OpenRouterAPI();
