CREATE TABLE IF NOT EXISTS shared_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    settings_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO shared_settings (
    id,
    settings_json
) VALUES (
    1,
    '{}'
);