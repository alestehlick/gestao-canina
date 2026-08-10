-- Reconciles the two lodging bookings whose deposit was removed in the UI.
-- Only untouched, unpaid deposit invoices are voided; any financial movement
-- makes the row ineligible and therefore preserves it for manual review.
UPDATE invoices
SET status = 'void',
    voided_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    void_reason = 'Sinal removido do agendamento antes do pagamento',
    updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE source_type = 'lodging_deposit'
  AND status IN ('draft', 'issued')
  AND NOT EXISTS (
    SELECT 1 FROM invoice_payments ip
    WHERE ip.invoice_id = invoices.id AND ip.status = 'active'
  )
  AND NOT EXISTS (
    SELECT 1 FROM invoice_settlements s
    WHERE s.invoice_id = invoices.id AND s.status = 'scheduled'
  )
  AND EXISTS (
    SELECT 1
    FROM invoice_items ii
    INNER JOIN appointment_items ai ON ai.id = ii.appointment_item_id
    INNER JOIN appointments a ON a.id = ai.appointment_id
    INNER JOIN dogs d ON d.id = a.dog_id
    WHERE ii.invoice_id = invoices.id
      AND lower(trim(d.name)) IN ('new', 'gauss')
  );

UPDATE appointments
SET deposit_percent = NULL,
    updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE deposit_percent IS NOT NULL
  AND status NOT IN ('completed', 'cancelled')
  AND EXISTS (
    SELECT 1 FROM dogs d
    WHERE d.id = appointments.dog_id
      AND lower(trim(d.name)) IN ('new', 'gauss')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM appointment_items ai
    INNER JOIN invoice_items ii ON ii.appointment_item_id = ai.id
    INNER JOIN invoices i ON i.id = ii.invoice_id
    WHERE ai.appointment_id = appointments.id
      AND i.status <> 'void'
  );

UPDATE appointment_items
SET description_snapshot = NULL,
    updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE appointment_id IN (
  SELECT a.id
  FROM appointments a
  INNER JOIN dogs d ON d.id = a.dog_id
  WHERE a.deposit_percent IS NULL
    AND lower(trim(d.name)) IN ('new', 'gauss')
)
AND description_snapshot LIKE 'Sinal de %';

PRAGMA optimize;
