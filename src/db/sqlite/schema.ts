import path from 'path';
import fs from 'fs';

// Get the user data path for persistent storage, or use a local file for dev
export const getDbPath = () => {
  let dbDir = process.cwd();

  // If configured via environment variable, respect it
  if (process.env.KARATETECH_DB_PATH) {
    return process.env.KARATETECH_DB_PATH;
  }

  // APPDATA on Windows
  if (process.env.APPDATA || (process.platform === 'win32' && process.env.USERPROFILE)) {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    dbDir = path.join(appData, 'KarateTech');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  return path.join(dbDir, 'karatetech.sqlite');
};

const dbPath = getDbPath();

let Database: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

export const localDb: any = Database
  ? new Database(dbPath)
  : {
      pragma: () => {},
      exec: () => {},
      prepare: () => ({ run: () => ({ changes: 0, lastInsertRowid: 0 }), get: () => null, all: () => [] }),
      transaction: (fn: any) => fn,
    };

if (Database) {
  // Enable WAL mode for high performance concurrent reading and writing
  localDb.pragma('journal_mode = WAL');
  localDb.pragma('synchronous = NORMAL');
  localDb.pragma('foreign_keys = ON');
}

// Initialize complete database schema
export const initDb = () => {
  localDb.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      organizer TEXT,
      date TEXT,
      date_iso TEXT,
      venue TEXT,
      city TEXT,
      registration_close TEXT,
      registration_close_iso TEXT,
      status TEXT DEFAULT 'Open',
      banner_gradient TEXT,
      featured INTEGER DEFAULT 0,
      deleted_at TEXT,
      discipline TEXT DEFAULT 'Kata, Kumite',
      medals_gold INTEGER DEFAULT 0,
      medals_silver INTEGER DEFAULT 0,
      medals_bronze INTEGER DEFAULT 0,
      total_participants INTEGER DEFAULT 0,
      total_clubs INTEGER DEFAULT 0,
      poster_emoji TEXT DEFAULT '🏆',
      pdf_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      name TEXT NOT NULL,
      city TEXT,
      state TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coaches (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      club_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      name TEXT NOT NULL,
      gender TEXT,
      min_age INTEGER,
      max_age INTEGER,
      min_weight REAL,
      max_weight REAL,
      capacity INTEGER DEFAULT 32,
      status TEXT DEFAULT 'Open',
      format TEXT DEFAULT 'knockout',
      category_timer_seconds INTEGER,
      category_timer_source TEXT,
      category_timer_updated_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      registration_no TEXT,
      photo_url TEXT,
      full_name TEXT NOT NULL,
      gender TEXT,
      dob TEXT,
      nationality_code TEXT,
      passport_ic TEXT,
      email TEXT,
      phone TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      club_id TEXT,
      coach_id TEXT,
      weight REAL DEFAULT 0,
      height REAL DEFAULT 0,
      status TEXT DEFAULT 'Pending',
      medical_status TEXT DEFAULT 'Cleared',
      payment_status TEXT DEFAULT 'Unpaid',
      remarks TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      name TEXT NOT NULL,
      club_id TEXT,
      coach_id TEXT,
      captain_id TEXT,
      score INTEGER DEFAULT 0,
      ranking INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      team_id TEXT,
      participant_id TEXT,
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS participant_categories (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      participant_id TEXT,
      category_id TEXT,
      manual_override INTEGER DEFAULT 0,
      assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(participant_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS bouts (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      category_id TEXT,
      bout_no INTEGER NOT NULL,
      round_no INTEGER NOT NULL,
      participant_a_id TEXT,
      participant_b_id TEXT,
      winner_id TEXT,
      score_a INTEGER DEFAULT 0,
      score_b INTEGER DEFAULT 0,
      status TEXT DEFAULT 'Scheduled',
      scheduled_time TEXT,
      tatami TEXT,
      senshu_a INTEGER DEFAULT 0,
      senshu_b INTEGER DEFAULT 0,
      penalties_a TEXT DEFAULT '',
      penalties_b TEXT DEFAULT '',
      timer_seconds INTEGER DEFAULT 180,
      timer_active INTEGER DEFAULT 0,
      vr_file_url TEXT,
      vr_metadata TEXT,
      vr_recorded_at TEXT,
      vr_duration_seconds INTEGER DEFAULT 0,
      vr_camera_label TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS officials (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      name TEXT NOT NULL,
      role TEXT,
      qualification TEXT,
      assigned_tatami TEXT,
      email TEXT,
      phone TEXT,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      participant_id TEXT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'Unpaid',
      payment_method TEXT,
      transaction_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS medical_records (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      participant_id TEXT,
      conditions TEXT,
      allergies TEXT,
      blood_type TEXT,
      has_clearance INTEGER DEFAULT 1,
      remarks TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      participant_id TEXT,
      name TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      file_url TEXT NOT NULL,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      participant_id TEXT,
      operator_name TEXT,
      action TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      tournament_id TEXT,
      user_id TEXT,
      user_email TEXT,
      action TEXT,
      table_name TEXT,
      record_id TEXT,
      old_values TEXT,
      new_values TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournament_pcs (
      id TEXT PRIMARY KEY,
      pc_identifier TEXT UNIQUE NOT NULL,
      pc_name TEXT,
      tournament_id TEXT,
      tatami TEXT,
      user_id TEXT,
      username TEXT,
      status TEXT DEFAULT 'online',
      current_category_id TEXT,
      current_match_id TEXT,
      last_heartbeat TEXT DEFAULT CURRENT_TIMESTAMP,
      is_admin_controlled INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS category_locks (
      id TEXT PRIMARY KEY,
      category_id TEXT UNIQUE NOT NULL,
      tournament_id TEXT,
      tatami TEXT NOT NULL,
      locked_at TEXT DEFAULT CURRENT_TIMESTAMP,
      locked_by TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS match_locks (
      id TEXT PRIMARY KEY,
      bout_id TEXT UNIQUE NOT NULL,
      tournament_id TEXT,
      tatami TEXT NOT NULL,
      locked_at TEXT DEFAULT CURRENT_TIMESTAMP,
      locked_by TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS server_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      user TEXT,
      role TEXT,
      action TEXT NOT NULL,
      tournament_id TEXT,
      match_id TEXT,
      details TEXT
    );
  `);
};

// Initialize schema on load
try {
  initDb();
} catch (err) {
  console.error('Error initializing SQLite schema:', err);
}
