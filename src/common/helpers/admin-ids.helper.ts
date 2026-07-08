export function getAdminTelegramIdsFromEnv(): string[] {
  const raw = process.env.ADMIN_IDS;

  if (!raw) return [];

  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
