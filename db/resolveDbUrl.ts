// Seleção da connection string por ambiente.
//
// Escolhe DATABASE_URL_<APP_ENV> (ex.: APP_ENV=dev -> DATABASE_URL_DEV) e, se
// essa variável estiver ausente/vazia, cai para DATABASE_URL puro. O fallback
// preserva o deploy na Railway, onde a plataforma injeta DATABASE_URL e não há
// APP_ENV. Função pura (recebe o env) para ser testável sem tocar o Pool.

export function pickDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const appEnv = (env.APP_ENV ?? '').trim().toLowerCase();
  const perEnv = appEnv ? env[`DATABASE_URL_${appEnv.toUpperCase()}`] : undefined;
  const chosen = (perEnv ?? '').trim() || (env.DATABASE_URL ?? '').trim();
  return chosen || undefined;
}
