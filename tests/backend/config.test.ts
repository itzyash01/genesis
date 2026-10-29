import { afterEach, describe, expect, it, vi } from 'vitest';
import { hlClientId, hlScopes, llmProvider, maxGenerationsPerHour, openaiModel } from '../../functions/src/config';
afterEach(()=>vi.unstubAllEnvs());
describe('server configuration',()=>{
  it('reads provider, rate limit and CRM parameters from the environment',()=>{
    vi.stubEnv('HL_CLIENT_ID','client');vi.stubEnv('HL_SCOPES','contacts.readonly');vi.stubEnv('LLM_PROVIDER','openai');vi.stubEnv('OPENAI_MODEL','test-model');vi.stubEnv('MAX_GENERATIONS_PER_HOUR','20');
    expect(hlClientId.value()).toBe('client');expect(hlScopes.value()).toBe('contacts.readonly');expect(llmProvider.value()).toBe('openai');expect(openaiModel.value()).toBe('test-model');expect(maxGenerationsPerHour.value()).toBe(20);
  });
});
