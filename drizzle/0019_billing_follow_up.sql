ALTER TABLE invoices ADD COLUMN follow_up_on text;

CREATE INDEX IF NOT EXISTS invoices_establishment_follow_up_idx
ON invoices (establishment_id, follow_up_on, status);

CREATE INDEX IF NOT EXISTS invoices_establishment_status_updated_idx
ON invoices (establishment_id, status, updated_at);

PRAGMA optimize;
