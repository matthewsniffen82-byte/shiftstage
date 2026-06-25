export type DancrPublicEnv = {
  siteUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function getPublicEnv(): DancrPublicEnv {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase public environment variables.");
  }

  return { siteUrl, supabaseUrl, supabaseAnonKey };
}

export function getServerEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing server environment variable: ${name}`);
  }

  return value;
}
