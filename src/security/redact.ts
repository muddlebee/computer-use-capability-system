const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_.*-]{6,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~-]+\b/gi,
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, "[REDACTED]"),
    value,
  );
}

export function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error";
  return redactSecrets(error.message);
}
