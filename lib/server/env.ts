import "server-only";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Read lazily so `next build` works without database credentials. */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new ConfigError("DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.");
  return url;
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
