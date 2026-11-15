/**
 * Secret Redaction Utility — Multi-pattern detection and masking
 * Masks credentials, private keys, API keys, tokens, and passwords across all output streams.
 */

const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC_AUTH_REGEX = /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi;
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const ANTHROPIC_KEY_REGEX = /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g;
const OPENAI_KEY_REGEX = /\bsk-(?!ant-)(?:proj-|live-)?[A-Za-z0-9_-]{20,}\b/g;
const GITHUB_TOKEN_REGEX = /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{22,})\b/g;
const AWS_KEY_ID_REGEX = /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g;
const AWS_SECRET_REGEX = /(?<=aws_secret_access_key\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40}(?=["']?)/gi;
const URL_PASSWORD_REGEX = /(https?:\/\/[^:\s\/]+):([^@\s\/]+)@/gi;
const PEM_PRIVATE_KEY_REGEX = /-----BEGIN (?:[A-Za-z0-9_ -]*?)PRIVATE KEY-----[\s\S]*?-----END (?:[A-Za-z0-9_ -]*?)PRIVATE KEY-----/g;

export function redactSecretsInText(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let out = text;

  // 1. PEM Private Keys
  out = out.replace(PEM_PRIVATE_KEY_REGEX, '-----BEGIN PRIVATE KEY-----\n[REDACTED_PRIVATE_KEY]\n-----END PRIVATE KEY-----');

  // 2. Bearer & Basic Auth Headers
  out = out.replace(BEARER_REGEX, 'Bearer [REDACTED]');
  out = out.replace(BASIC_AUTH_REGEX, 'Basic [REDACTED]');

  // 3. JWT Tokens
  out = out.replace(JWT_REGEX, '[REDACTED_JWT]');

  // 4. Provider API Keys
  out = out.replace(ANTHROPIC_KEY_REGEX, '[REDACTED_ANTHROPIC_KEY]');
  out = out.replace(OPENAI_KEY_REGEX, '[REDACTED_OPENAI_KEY]');
  out = out.replace(GITHUB_TOKEN_REGEX, '[REDACTED_GITHUB_TOKEN]');

  // 5. AWS Credentials
  out = out.replace(AWS_KEY_ID_REGEX, '[REDACTED_AWS_KEY]');
  out = out.replace(AWS_SECRET_REGEX, '[REDACTED_AWS_SECRET]');

  // 6. URL Embedded Credentials
  out = out.replace(URL_PASSWORD_REGEX, '$1:[REDACTED]@');

  // 7. Generic Key/Token/Secret/Password Assignment Lines
  out = out
    .split('\n')
    .map((line) => {
      if (/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|PRIVATE)/i.test(line)) {
        return line.replace(/(:\s*["']?|=\s*["']?)(?!(?:Bearer\s+\[REDACTED\]|Basic\s+\[REDACTED\]|\[REDACTED))([^"'\s\r\n;]{6,})([;"']?)/gi, '$1[REDACTED]$3');
      }
      return line;
    })
    .join('\n');

  return out;
}
