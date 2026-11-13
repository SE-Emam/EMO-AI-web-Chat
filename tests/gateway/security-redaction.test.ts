import { describe, it, expect } from 'vitest';
import { redactSecrets, restoreSecrets } from '../../src/gateway/security.js';

describe('Security Secret Redaction', () => {
  it('masks OpenAI, Anthropic, GitHub, and AWS keys and restores them', () => {
    const originalText = `
Here are my sensitive keys:
OPENAI: sk-proj-1234567890abcdef1234567890abcdef12345678
ANTHROPIC: sk-ant-api03-abcdef1234567890abcdef1234567890abcdef
GITHUB: ghp_1234567890abcdef1234567890abcdef123456
AWS: AKIAIOSFODNN7EXAMPLE
`.trim();

    const { redactedText, secretsCount, mapping } = redactSecrets(originalText);

    expect(secretsCount).toBeGreaterThanOrEqual(4);
    expect(redactedText).not.toContain('sk-proj-1234567890abcdef1234567890abcdef12345678');
    expect(redactedText).not.toContain('sk-ant-api03-abcdef1234567890abcdef1234567890abcdef');
    expect(redactedText).not.toContain('ghp_1234567890abcdef1234567890abcdef123456');
    expect(redactedText).not.toContain('AKIAIOSFODNN7EXAMPLE');

    expect(redactedText).toContain('{{REDACTED_OPENAI_API_KEY_');
    expect(redactedText).toContain('{{REDACTED_ANTHROPIC_API_KEY_');
    expect(redactedText).toContain('{{REDACTED_GITHUB_TOKEN_');
    expect(redactedText).toContain('{{REDACTED_AWS_ACCESS_KEY_');

    // Test restoration
    const restored = restoreSecrets(redactedText, mapping);
    expect(restored).toBe(originalText);
  });

  it('masks PEM private keys correctly', () => {
    const pemKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+examplePrivateDataKey123456789==
-----END RSA PRIVATE KEY-----`;

    const input = `My cert key is:\n${pemKey}\nDone.`;
    const { redactedText, secretsCount, mapping } = redactSecrets(input);

    expect(secretsCount).toBe(1);
    expect(redactedText).not.toContain('MIIEowIBAAKCAQEA0Y1+examplePrivateDataKey123456789==');
    expect(redactedText).toContain('{{REDACTED_PRIVATE_KEY_1}}');

    const restored = restoreSecrets(redactedText, mapping);
    expect(restored).toBe(input);
  });
});
