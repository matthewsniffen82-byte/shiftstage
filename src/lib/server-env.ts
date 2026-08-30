import "server-only";

export function getServerEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing server environment variable: ${name}`);
  }

  return value;
}

export function getOptionalServerEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}
