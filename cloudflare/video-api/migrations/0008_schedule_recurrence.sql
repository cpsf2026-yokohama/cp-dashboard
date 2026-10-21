ALTER TABLE schedules
ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'
CHECK (recurrence IN ('none', 'daily', 'weekly'));

ALTER TABLE schedules
ADD COLUMN recurrence_until TEXT;
