const mem = new Map<string, string>();

function stores(): Storage[] {
  const out: Storage[] = [];
  try {
    out.push(window.localStorage);
  } catch {
    /* unavailable */
  }
  try {
    out.push(window.sessionStorage);
  } catch {
    /* unavailable */
  }
  return out;
}

export function getItem(key: string): string | null {
  for (const s of stores()) {
    try {
      const v = s.getItem(key);
      if (v !== null) return v;
    } catch {
      /* ignore */
    }
  }
  return mem.get(key) ?? null;
}

export function setItem(key: string, value: string) {
  mem.set(key, value);
  for (const s of stores()) {
    try {
      s.setItem(key, value);
      return;
    } catch {
      /* try next */
    }
  }
}

export function removeItem(key: string) {
  mem.delete(key);
  for (const s of stores()) {
    try {
      s.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export function getJson<T>(key: string): T | null {
  const v = getItem(key);
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export const setJson = (key: string, v: unknown) => setItem(key, JSON.stringify(v));

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function tokenFor(code: string): string {
  const key = `ss.t.${code}`;
  const existing = getItem(key);
  if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
  const t = randomToken();
  setItem(key, t);
  return t;
}
