import "server-only";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function normalizeDatabaseUrl(url: string): string {
  if (!url) return url;

  try {
    const parsed = new URL(url);
    const isLocalDatabase = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" || parsed.hostname === "[::1]";
    const params = parsed.searchParams;

    if (isLocalDatabase) {
      params.delete("sslmode");
      params.set("sslmode", "disable");
    } else {
      params.delete("sslmode");
      params.set("sslmode", "verify-full");
    }

    parsed.search = params.toString();
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Read lazily so `next build` works without database credentials. */
export function getDatabaseUrl(): string {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new ConfigError("DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.");
  return normalizeDatabaseUrl(rawUrl);
}

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new ConfigError("AUTH_SECRET must be set to a random value of at least 32 characters (see .env.example).");
  }
  return secret;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
