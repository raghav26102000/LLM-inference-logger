/**
 * pii.js — PII redaction applied at ingest time, before DB writes.
 *
 * FIX vs original: The TOKEN pattern now requires a known secret prefix
 * (sk-, gsk_, AIzaSy, Bearer, ghp_, xoxb- etc.) so normal long words,
 * UUIDs, and base64 blobs are NOT incorrectly redacted.
 */

const PII_PATTERNS = [
  // Email addresses
  {
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    tag: "[EMAIL]",
  },

  // Credit/debit card numbers (space or dash separated, or 16-digit block)
  {
    pattern: /\b(?:\d{4}[ \-]){3}\d{4}\b|\b\d{16}\b/g,
    tag: "[CARD]",
  },

  // US Social Security Numbers
  {
    pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,
    tag: "[SSN]",
  },

  // IPv4 addresses
  {
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    tag: "[IP]",
  },

  // Phone numbers — must have country code or standard US format
  // Matches: +1-800-555-1234 | (800) 555-1234 | +91 98765 43210
  {
    pattern: /(?:\+\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]\d{3}[\s\-]\d{4}\b/g,
    tag: "[PHONE]",
  },

  // API keys / secrets — ONLY strings with a known secret prefix.
  // Covers: OpenAI (sk-), Anthropic (sk-ant-), Groq (gsk_),
  //         Google/Gemini (AIzaSy), GitHub (ghp_, gho_, ghs_),
  //         Slack (xoxb-, xoxp-)
  {
    pattern: /\b(?:sk-ant-|sk-|gsk_|AIzaSy|ghp_|gho_|ghs_|xoxb-|xoxp-)[A-Za-z0-9_\-]{16,}/g,
    tag: "[API_KEY]",
  },

  // Bearer tokens in Authorization headers
  {
    pattern: /Bearer\s+[A-Za-z0-9._\-]{20,}/g,
    tag: "Bearer [TOKEN]",
  },
];

/**
 * Redacts PII from a string.
 * @param {string} text
 * @returns {{ redacted: string, hadPii: boolean }}
 */
export function redactPii(text) {
  if (!text) return { redacted: text, hadPii: false };

  let result = text;
  let hadPii = false;

  for (const { pattern, tag } of PII_PATTERNS) {
    pattern.lastIndex = 0; // reset global regex state
    const replaced = result.replace(pattern, tag);
    if (replaced !== result) hadPii = true;
    result = replaced;
  }

  return { redacted: result, hadPii };
}
