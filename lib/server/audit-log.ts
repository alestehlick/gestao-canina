import { getD1Database } from "@/db";
import type { WorkspaceAuditEvent } from "@/lib/workspace-data";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function loadAuditLog(
  establishmentId: string,
  from: string,
  to: string,
  limit = 500,
): Promise<WorkspaceAuditEvent[]> {
  // O estabelecimento opera em São Paulo. 03:00Z corresponde à meia-noite
  // local e impede que ações do fim do dia apareçam na data seguinte.
  const fromTimestamp = `${from}T03:00:00.000Z`;
  const toTimestamp = `${addDays(to, 1)}T03:00:00.000Z`;
  const result = await getD1Database()
    .prepare(
      `SELECT
        ae.id,
        ae.actor_role AS actorRole,
        au.display_name AS actorName,
        ae.action,
        ae.entity_type AS entityType,
        ae.entity_id AS entityId,
        ae.reason,
        ae.result,
        ae.metadata_json AS metadataJson,
        ae.occurred_at AS occurredAt,
        CASE
          WHEN ae.entity_type = 'appointment' THEN (
            SELECT d.name FROM appointments a
            JOIN dogs d ON d.id = a.dog_id WHERE a.id = ae.entity_id
          )
          WHEN ae.entity_type = 'dog' THEN (
            SELECT d.name FROM dogs d WHERE d.id = ae.entity_id
          )
          WHEN ae.entity_type IN ('customer', 'customer_account') THEN (
            SELECT ca.display_name FROM customer_accounts ca WHERE ca.id = ae.entity_id
          )
          WHEN ae.entity_type = 'task' THEN (
            SELECT t.title FROM tasks t WHERE t.id = ae.entity_id
          )
          WHEN ae.entity_type = 'invoice' THEN (
            SELECT i.recipient_name_snapshot FROM invoices i WHERE i.id = ae.entity_id
          )
          WHEN ae.entity_type = 'payment' THEN (
            SELECT i.recipient_name_snapshot FROM invoice_payments ip
            JOIN invoices i ON i.id = ip.invoice_id WHERE ip.id = ae.entity_id
          )
          WHEN ae.entity_type = 'credit_purchase' THEN (
            SELECT ca.display_name FROM credit_purchases cp
            JOIN customer_accounts ca ON ca.id = cp.account_id WHERE cp.id = ae.entity_id
          )
          WHEN ae.entity_type = 'credit_receipt' THEN (
            SELECT cr.dog_name_snapshot FROM credit_receipts cr WHERE cr.id = ae.entity_id
          )
          WHEN ae.entity_type = 'credit_movement' THEN (
            SELECT ca.display_name FROM credit_movements cm
            JOIN customer_accounts ca ON ca.id = cm.account_id WHERE cm.id = ae.entity_id
          )
          WHEN ae.entity_type = 'cash_entry' THEN (
            SELECT ce.description FROM cash_entries ce WHERE ce.id = ae.entity_id
          )
          WHEN ae.entity_type = 'cash_transfer' THEN (
            SELECT ct.description FROM cash_transfers ct WHERE ct.id = ae.entity_id
          )
          WHEN ae.entity_type = 'financial_account' THEN (
            SELECT fa.name FROM financial_accounts fa WHERE fa.id = ae.entity_id
          )
          WHEN ae.entity_type = 'cash_period' THEN (
            SELECT cp.period_start || ' a ' || cp.period_end FROM cash_periods cp WHERE cp.id = ae.entity_id
          )
          WHEN ae.entity_type = 'service_catalog' THEN (
            SELECT sc.name FROM service_catalog sc WHERE sc.id = ae.entity_id
          )
          WHEN ae.entity_type = 'customer_request' THEN (
            SELECT COALESCE(d.name, ca.display_name)
            FROM customer_requests cr
            JOIN customer_accounts ca ON ca.id = cr.account_id
            LEFT JOIN dogs d ON d.id = cr.dog_id
            WHERE cr.id = ae.entity_id
          )
          ELSE NULL
        END AS subjectName,
        CASE
          WHEN ae.entity_type = 'appointment' THEN (
            SELECT ca.display_name FROM appointments a
            JOIN customer_accounts ca ON ca.id = a.account_id WHERE a.id = ae.entity_id
          )
          WHEN ae.entity_type = 'dog' THEN (
            SELECT ca.display_name FROM dogs d
            JOIN customer_accounts ca ON ca.id = d.account_id WHERE d.id = ae.entity_id
          )
          WHEN ae.entity_type = 'credit_receipt' THEN (
            SELECT cr.customer_name_snapshot FROM credit_receipts cr WHERE cr.id = ae.entity_id
          )
          WHEN ae.entity_type = 'customer_request' THEN (
            SELECT ca.display_name FROM customer_requests cr
            JOIN customer_accounts ca ON ca.id = cr.account_id
            WHERE cr.id = ae.entity_id
          )
          ELSE NULL
        END AS secondaryName,
        CASE
          WHEN ae.entity_type = 'appointment' THEN (
            SELECT ai.service_name_snapshot FROM appointment_items ai
            WHERE ai.appointment_id = ae.entity_id ORDER BY ai.created_at LIMIT 1
          )
          WHEN ae.entity_type = 'credit_purchase' THEN (
            SELECT cp.package_name_snapshot FROM credit_purchases cp WHERE cp.id = ae.entity_id
          )
          WHEN ae.entity_type = 'credit_receipt' THEN (
            SELECT cr.service_name_snapshot FROM credit_receipts cr WHERE cr.id = ae.entity_id
          )
          WHEN ae.entity_type = 'credit_movement' THEN (
            SELECT sc.name FROM credit_movements cm
            JOIN service_catalog sc ON sc.id = cm.service_catalog_id WHERE cm.id = ae.entity_id
          )
          WHEN ae.entity_type = 'customer_request' THEN (
            SELECT sc.name FROM customer_requests cr
            LEFT JOIN service_catalog sc ON sc.id = cr.service_catalog_id
            WHERE cr.id = ae.entity_id
          )
          ELSE NULL
        END AS serviceName,
        CASE
          WHEN ae.entity_type = 'appointment' THEN (
            SELECT a.start_date FROM appointments a WHERE a.id = ae.entity_id
          )
          WHEN ae.entity_type = 'invoice' THEN (
            SELECT i.due_date FROM invoices i WHERE i.id = ae.entity_id
          )
          WHEN ae.entity_type = 'payment' THEN (
            SELECT substr(ip.paid_at, 1, 10) FROM invoice_payments ip WHERE ip.id = ae.entity_id
          )
          WHEN ae.entity_type = 'cash_entry' THEN (
            SELECT ce.occurred_on FROM cash_entries ce WHERE ce.id = ae.entity_id
          )
          WHEN ae.entity_type = 'cash_transfer' THEN (
            SELECT ct.occurred_on FROM cash_transfers ct WHERE ct.id = ae.entity_id
          )
          WHEN ae.entity_type = 'cash_period' THEN (
            SELECT cp.period_end FROM cash_periods cp WHERE cp.id = ae.entity_id
          )
          WHEN ae.entity_type = 'credit_movement' THEN (
            SELECT substr(cm.occurred_at, 1, 10) FROM credit_movements cm WHERE cm.id = ae.entity_id
          )
          WHEN ae.entity_type = 'customer_request' THEN (
            SELECT cr.requested_date FROM customer_requests cr WHERE cr.id = ae.entity_id
          )
          ELSE NULL
        END AS eventDate,
        CASE
          WHEN ae.entity_type = 'invoice' THEN (
            SELECT i.total_cents FROM invoices i WHERE i.id = ae.entity_id
          )
          WHEN ae.entity_type = 'payment' THEN (
            SELECT ip.amount_cents FROM invoice_payments ip WHERE ip.id = ae.entity_id
          )
          WHEN ae.entity_type = 'credit_purchase' THEN (
            SELECT cp.amount_cents FROM credit_purchases cp WHERE cp.id = ae.entity_id
          )
          WHEN ae.entity_type = 'cash_entry' THEN (
            SELECT ce.amount_cents FROM cash_entries ce WHERE ce.id = ae.entity_id
          )
          WHEN ae.entity_type = 'cash_transfer' THEN (
            SELECT ct.amount_cents FROM cash_transfers ct WHERE ct.id = ae.entity_id
          )
          ELSE NULL
        END AS amountCents,
        CASE
          WHEN ae.entity_type = 'invoice' THEN (
            SELECT i.invoice_number FROM invoices i WHERE i.id = ae.entity_id
          )
          WHEN ae.entity_type = 'payment' THEN (
            SELECT i.invoice_number FROM invoice_payments ip
            JOIN invoices i ON i.id = ip.invoice_id WHERE ip.id = ae.entity_id
          )
          WHEN ae.entity_type = 'credit_receipt' THEN (
            SELECT cr.receipt_number FROM credit_receipts cr WHERE cr.id = ae.entity_id
          )
          ELSE NULL
        END AS referenceNumber,
        CASE
          WHEN ae.entity_type = 'appointment' THEN (
            SELECT a.status FROM appointments a WHERE a.id = ae.entity_id
          )
          ELSE NULL
        END AS currentStatus
      FROM audit_events ae
      LEFT JOIN app_users au ON au.id = ae.actor_user_id
      WHERE ae.establishment_id = ?
        AND ae.occurred_at >= ?
        AND ae.occurred_at < ?
      ORDER BY ae.occurred_at DESC
      LIMIT ?`,
    )
    .bind(establishmentId, fromTimestamp, toTimestamp, limit)
    .all<WorkspaceAuditEvent>();

  return result.results;
}
