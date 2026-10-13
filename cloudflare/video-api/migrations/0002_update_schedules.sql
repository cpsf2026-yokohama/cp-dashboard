DROP TABLE IF EXISTS schedules;

CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX idx_schedules_time
    ON schedules(starts_at);
