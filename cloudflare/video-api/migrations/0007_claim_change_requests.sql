CREATE TABLE change_requests_with_claim (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'approved', 'rejected')),
    reviewed_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    FOREIGN KEY (requester_id) REFERENCES users(id),
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

INSERT INTO change_requests_with_claim
    (id, requester_id, kind, summary, payload_json, status, reviewed_by, created_at, reviewed_at)
    SELECT id, requester_id, kind, summary, payload_json, status, reviewed_by, created_at, reviewed_at
    FROM change_requests;

DROP TABLE change_requests;
ALTER TABLE change_requests_with_claim RENAME TO change_requests;
CREATE INDEX IF NOT EXISTS idx_change_requests_status_created
    ON change_requests(status, created_at);
