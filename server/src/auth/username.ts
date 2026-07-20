/**
 * Usernames are matched case-insensitively and without surrounding whitespace.
 * Every read and write of a username goes through this so the initial-admin
 * bootstrap, login, and account creation all agree on the canonical form.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}
