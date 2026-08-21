import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDefaultLlmConfig } from '../llm';
import { getAdminLlmDefault } from '../llm-defaults';

vi.mock('../llm-defaults', () => ({ getAdminLlmDefault: vi.fn() }));

describe('getDefaultLlmConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('returns the admin default when provider + model + key are set', async () => {
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: '',
      apiKey: 'sk-admin',
    } as any);

    const cfg = await getDefaultLlmConfig();
    expect(cfg).toEqual({
      apiKey: 'sk-admin',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      provider: 'openai',
    });
  });

  it('uses the stored baseUrl when present', async () => {
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-admin',
    } as any);

    const cfg = await getDefaultLlmConfig();
    expect(cfg?.baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('returns an Ollama default without a key', async () => {
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: 'ollama',
      model: 'llama3',
      baseUrl: '',
      apiKey: '',
    } as any);

    const cfg = await getDefaultLlmConfig();
    expect(cfg?.provider).toBe('ollama');
    expect(cfg?.model).toBe('llama3');
    expect(cfg?.apiKey).toBe('');
  });

  it('returns null when the admin default has no provider or model', async () => {
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: '',
      model: '',
      baseUrl: '',
      apiKey: 'sk-orphan',
    } as any);

    expect(await getDefaultLlmConfig()).toBeNull();
  });

  it('returns null when nothing is configured', async () => {
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: '',
      model: '',
      baseUrl: '',
      apiKey: '',
    } as any);

    expect(await getDefaultLlmConfig()).toBeNull();
  });

  it('no longer falls back to a legacy DEEPSEEK_API_KEY env var', async () => {
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: '',
      model: '',
      baseUrl: '',
      apiKey: '',
    } as any);
    process.env.DEEPSEEK_API_KEY = 'sk-env-secret-long';

    expect(await getDefaultLlmConfig()).toBeNull();
  });
});
