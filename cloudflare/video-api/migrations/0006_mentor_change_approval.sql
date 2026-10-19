PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS change_requests (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    FOREIGN KEY (requester_id) REFERENCES users(id),
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_change_requests_status_created
    ON change_requests(status, created_at);

-- Extend the role constraint while preserving every existing user record.
CREATE TABLE users_with_mentor (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'producer', 'operator', 'mentor')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users_with_mentor (id, email, role, created_at)
    SELECT id, email, role, created_at FROM users;

CREATE TABLE videos_with_mentor (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, r2_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (uploaded_by) REFERENCES users_with_mentor(id)
);
INSERT INTO videos_with_mentor SELECT * FROM videos;

CREATE TABLE schedules_with_mentor (
    id TEXT PRIMARY KEY, video_id TEXT NOT NULL, starts_at TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos_with_mentor(id),
    FOREIGN KEY (created_by) REFERENCES users_with_mentor(id)
);
INSERT INTO schedules_with_mentor SELECT * FROM schedules;

CREATE TABLE audit_logs_with_mentor (
    id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL,
    target_type TEXT, target_id TEXT, details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (actor_id) REFERENCES users_with_mentor(id)
);
INSERT INTO audit_logs_with_mentor SELECT * FROM audit_logs;

DROP TABLE schedules;
DROP TABLE videos;
DROP TABLE audit_logs;
DROP TABLE users;
ALTER TABLE users_with_mentor RENAME TO users;
ALTER TABLE videos_with_mentor RENAME TO videos;
ALTER TABLE schedules_with_mentor RENAME TO schedules;
ALTER TABLE audit_logs_with_mentor RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_schedules_time ON schedules(starts_at);
