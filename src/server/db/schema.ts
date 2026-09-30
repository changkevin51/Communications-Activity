export const MIGRATIONS: string[] = [
  `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL CHECK (mode IN ('live','test')),
  phase TEXT NOT NULL DEFAULT 'open' CHECK (phase IN ('open','released','closed')),
  config_json TEXT NOT NULL, seed TEXT NOT NULL,
  release_json TEXT,
  created_at INTEGER NOT NULL, released_at INTEGER, reveal_at INTEGER, closed_at INTEGER
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('human','bot','ghost')),
  token_hash TEXT,
  codename TEXT NOT NULL, sigil_json TEXT NOT NULL,
  stage TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1,
  joined_at INTEGER NOT NULL, started_at INTEGER, scored_at INTEGER, rated_before_at INTEGER,
  assigned_at INTEGER, recap_seen_at INTEGER, done_at INTEGER, last_seen_at INTEGER, removed_at INTEGER,
  flags_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (session_id, codename)
);
CREATE UNIQUE INDEX participants_token ON participants(session_id, token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX participants_stage ON participants(session_id, stage);

CREATE TABLE attempts (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL, game_version TEXT NOT NULL, seed TEXT NOT NULL, study_scale REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('playing','complete')),
  started_at INTEGER NOT NULL, completed_at INTEGER, score INTEGER,
  stats_json TEXT,
  flags_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE rounds (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, variant INTEGER NOT NULL, target INTEGER NOT NULL,
  tapped INTEGER, correct INTEGER NOT NULL, rt_ms INTEGER, study_ms INTEGER, mask_ms INTEGER,
  PRIMARY KEY (participant_id, idx)
);

CREATE TABLE ratings (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('before','after')),
  value REAL NOT NULL CHECK (value >= 0 AND value <= 100),
  response_ms INTEGER, adjustments INTEGER, created_at INTEGER NOT NULL,
  PRIMARY KEY (participant_id, phase)
);

CREATE TABLE assignments (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('up','neutral','down')),
  batch TEXT NOT NULL CHECK (batch IN ('release','late','instant')),
  stratum INTEGER,
  viewer_score INTEGER NOT NULL, thresholds_json TEXT NOT NULL, algo_version TEXT NOT NULL,
  assigned_at INTEGER NOT NULL, reveal_at INTEGER NOT NULL, dial_dwell_ms INTEGER
);

CREATE TABLE shown_peers (
  viewer_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  peer_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  peer_kind TEXT NOT NULL, peer_score INTEGER NOT NULL, diff INTEGER NOT NULL,
  PRIMARY KEY (viewer_id, slot)
);
CREATE INDEX shown_peers_peer ON shown_peers(peer_id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, participant_id TEXT,
  type TEXT NOT NULL, at INTEGER NOT NULL, data_json TEXT
);
`,
  `
CREATE TABLE reveal_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('live','test','demo')),
  scenario TEXT, seed TEXT,
  version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  counts_json TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  data_json TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX reveal_snapshots_session ON reveal_snapshots(session_id, created_at);
CREATE TRIGGER reveal_snapshots_immutable BEFORE UPDATE ON reveal_snapshots
BEGIN SELECT RAISE(ABORT, 'snapshot is immutable'); END;
CREATE TRIGGER reveal_snapshots_demo_guard BEFORE INSERT ON reveal_snapshots
WHEN NEW.source = 'demo' AND (SELECT mode FROM sessions WHERE id = NEW.session_id) = 'live'
BEGIN SELECT RAISE(ABORT, 'demo data on live session'); END;

CREATE TABLE presentations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  scene TEXT NOT NULL DEFAULT 'lobby',
  beat INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 1,
  nonce INTEGER NOT NULL DEFAULT 0,
  hold INTEGER NOT NULL DEFAULT 0,
  plain INTEGER NOT NULL DEFAULT 0,
  motion TEXT NOT NULL DEFAULT 'full' CHECK (motion IN ('full','calm','off')),
  auto INTEGER NOT NULL DEFAULT 1,
  snapshot_id TEXT REFERENCES reveal_snapshots(id),
  screen_key TEXT NOT NULL,
  controller TEXT,
  controller_at INTEGER,
  concept_json TEXT NOT NULL DEFAULT '{"title":"","quotes":[]}',
  changed_at INTEGER NOT NULL,
  cmd_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE presentation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  cmd TEXT NOT NULL, from_scene TEXT, from_beat INTEGER, to_scene TEXT, to_beat INTEGER, rev INTEGER NOT NULL
);
`,
];
