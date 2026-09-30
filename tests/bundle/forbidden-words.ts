import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv[2] ?? 'dist/client';
const FORBIDDEN = [
  'upward', 'downward', 'reference group', 'social comparison', 'experiment', 'ghost', 'synthetic',
  'fabricat', 'manipulat', 'stratum', 'control group', 'condition',
];
const ALLOW: RegExp[] = [/\bconditional\b/gi, /\bconditions?\s*[:=]/gi, /precondition/gi];

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const hostHtml = readFileSync(join(DIST, 'host.html'), 'utf8');
const refs = (h: string) => [...h.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const hostOnly = new Set(refs(hostHtml).filter((r) => !refs(html).includes(r)));

const participantFiles = new Set<string>(refs(html));
const queue = [...participantFiles];
while (queue.length) {
  const f = queue.pop()!;
  const src = readFileSync(join(DIST, f), 'utf8');
  for (const m of src.matchAll(/["'`(]\.?\/?((?:assets\/)?[\w.-]+\.js)["'`)]/g)) {
    const p = m[1].startsWith('assets/') ? m[1] : `assets/${m[1]}`;
    if (!participantFiles.has(p) && !hostOnly.has(p) && readdirSync(join(DIST, 'assets')).includes(p.slice(7))) {
      participantFiles.add(p);
      queue.push(p);
    }
  }
}

let failed = false;
for (const f of [...participantFiles, 'index.html']) {
  let src = readFileSync(join(DIST, f), 'utf8');
  for (const a of ALLOW) src = src.replace(a, '');
  const lower = src.toLowerCase();
  for (const w of FORBIDDEN) {
    const i = lower.indexOf(w);
    if (i >= 0) {
      failed = true;
      console.error(`${f}: forbidden "${w}" near …${src.slice(Math.max(0, i - 40), i + 40)}…`);
    }
  }
  if (/host\.html|\/host\b|x-admin-key/.test(src)) {
    failed = true;
    console.error(`${f}: references host console`);
  }
}
if (failed) process.exit(1);
console.log(`bundle ok: ${participantFiles.size} participant chunk(s) clean`);
