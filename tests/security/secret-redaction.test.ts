import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecretsInText } from '../../src/server/secret-redaction.js';

describe('Multi-Pattern Secret Redaction Utility', () => {
  test('Redacts Bearer authorization tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID';
    const redacted = redactSecretsInText(input);
    assert.ok(redacted.includes('Bearer [REDACTED]'));
    assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  });

  test('Redacts Basic authentication headers', () => {
    const input = 'Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQxMjM=';
    const redacted = redactSecretsInText(input);
    assert.ok(redacted.includes('Basic [REDACTED]'));
    assert.ok(!redacted.includes('dXNlcm5hbWU6cGFzc3dvcmQxMjM='));
  });

  test('Redacts raw JWT tokens anywhere in text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHclpkw';
    const input = `User payload contains token: ${jwt}`;
    const redacted = redactSecretsInText(input);
    assert.ok(redacted.includes('[REDACTED_JWT]'));
    assert.ok(!redacted.includes(jwt));
  });

  test('Redacts OpenAI and Anthropic API keys', () => {
    const oaiKey = 'sk-proj-abc1234567890def1234567890ghijk';
    const antKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890';
    const input = `OpenAI: ${oaiKey}, Anthropic: ${antKey}`;
    const redacted = redactSecretsInText(input);
    assert.ok(redacted.includes('[REDACTED_OPENAI_KEY]'));
    assert.ok(redacted.includes('[REDACTED_ANTHROPIC_KEY]'));
    assert.ok(!redacted.includes(oaiKey));
    assert.ok(!redacted.includes(antKey));
  });

  test('Redacts GitHub Personal Access Tokens and Fine-grained tokens', () => {
    const ghp = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz12';
    const pat = 'github_pat_11A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7';
    const input = `Tokens: ${ghp} and ${pat}`;
    const redacted = redactSecretsInText(input);
    assert.ok(redacted.includes('[REDACTED_GITHUB_TOKEN]'));
    assert.ok(!redacted.includes(ghp));
    assert.ok(!redacted.includes(pat));
  });

  test('Redacts AWS Access Key IDs and Secrets', () => {
    const keyId = 'AKIAIOSFODNN7EXAMPLE';
    const input = `aws_access_key_id = ${keyId}\naws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`;
    const redacted = redactSecretsInText(input);
    assert.ok(redacted.includes('[REDACTED_AWS_KEY]'));
    assert.ok(redacted.includes('[REDACTED_AWS_SECRET]'));
    assert.ok(!redacted.includes(keyId));
    assert.ok(!redacted.includes('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'));
  });

  test('Redacts URL embedded passwords', () => {
    const input = 'Connect to https://admin:superSecretPass123@postgres.internal.net:5432/db';
    const redacted = redactSecretsInText(input);
    assert.ok(redacted.includes('https://admin:[REDACTED]@postgres.internal.net:5432/db'));
    assert.ok(!redacted.includes('superSecretPass123'));
  });

  test('Redacts PEM format RSA / EC Private Keys', () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+examplePrivateDataKeyContent1234567890
abcdefghijklmnopqrstuvwxyz==
-----END RSA PRIVATE KEY-----`;
    const redacted = redactSecretsInText(input);
    assert.ok(redacted.includes('[REDACTED_PRIVATE_KEY]'));
    assert.ok(!redacted.includes('MIIEowIBAAKCAQEA0Y1+examplePrivateDataKeyContent1234567890'));
  });
});
