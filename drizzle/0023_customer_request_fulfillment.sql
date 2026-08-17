ALTER TABLE `customer_requests` ADD `requested_start_time` text;
ALTER TABLE `customer_requests` ADD `requested_end_time` text;
ALTER TABLE `customer_requests` ADD `details_json` text;

-- Preserve the oldest request when old retries produced exact duplicates.
-- The redundant copies remain visible in history as cancelled.
UPDATE `customer_requests`
SET `status` = 'cancelled',
  `response_note` = COALESCE(
    `response_note`,
    'Pedido duplicado consolidado automaticamente.'
  ),
  `reviewed_at` = COALESCE(
    `reviewed_at`,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (
  SELECT ranked.id
  FROM (
    SELECT id,
      row_number() OVER (
        PARTITION BY establishment_id, dog_id, service_catalog_id, requested_date
        ORDER BY created_at, id
      ) AS duplicate_rank
    FROM customer_requests
    WHERE type = 'service' AND status = 'pending'
  ) ranked
  WHERE ranked.duplicate_rank > 1
);

UPDATE `customer_requests`
SET `status` = 'cancelled',
  `response_note` = COALESCE(
    `response_note`,
    'Pedido duplicado consolidado automaticamente.'
  ),
  `reviewed_at` = COALESCE(
    `reviewed_at`,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (
  SELECT ranked.id
  FROM (
    SELECT id,
      row_number() OVER (
        PARTITION BY appointment_id
        ORDER BY created_at, id
      ) AS duplicate_rank
    FROM customer_requests
    WHERE type = 'cancellation' AND status = 'pending'
      AND appointment_id IS NOT NULL
  ) ranked
  WHERE ranked.duplicate_rank > 1
);

CREATE UNIQUE INDEX `customer_requests_pending_service_unique`
ON `customer_requests` (
  `establishment_id`, `dog_id`, `service_catalog_id`, `requested_date`
)
WHERE `type` = 'service' AND `status` = 'pending';

CREATE UNIQUE INDEX `customer_requests_pending_cancellation_unique`
ON `customer_requests` (`appointment_id`)
WHERE `type` = 'cancellation' AND `status` = 'pending';

CREATE TRIGGER `customer_requests_prevent_pending_lodging_overlap_insert`
BEFORE INSERT ON `customer_requests`
WHEN NEW.type = 'service' AND NEW.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM service_catalog requested_service
    WHERE requested_service.id = NEW.service_catalog_id
      AND requested_service.code = 'hotel'
  )
  AND EXISTS (
    SELECT 1
    FROM customer_requests existing
    INNER JOIN service_catalog existing_service
      ON existing_service.id = existing.service_catalog_id
    WHERE existing.establishment_id = NEW.establishment_id
      AND existing.dog_id = NEW.dog_id
      AND existing.type = 'service'
      AND existing.status = 'pending'
      AND existing_service.code = 'hotel'
      AND existing.requested_date <= COALESCE(NEW.requested_end_date, NEW.requested_date)
      AND COALESCE(existing.requested_end_date, existing.requested_date) >= NEW.requested_date
  )
BEGIN
  SELECT RAISE(ABORT, 'customer_request_lodging_overlap');
END;

CREATE TRIGGER `customer_requests_prevent_pending_lodging_overlap_update`
BEFORE UPDATE OF status, dog_id, service_catalog_id, requested_date, requested_end_date
ON `customer_requests`
WHEN NEW.type = 'service' AND NEW.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM service_catalog requested_service
    WHERE requested_service.id = NEW.service_catalog_id
      AND requested_service.code = 'hotel'
  )
  AND EXISTS (
    SELECT 1
    FROM customer_requests existing
    INNER JOIN service_catalog existing_service
      ON existing_service.id = existing.service_catalog_id
    WHERE existing.id <> NEW.id
      AND existing.establishment_id = NEW.establishment_id
      AND existing.dog_id = NEW.dog_id
      AND existing.type = 'service'
      AND existing.status = 'pending'
      AND existing_service.code = 'hotel'
      AND existing.requested_date <= COALESCE(NEW.requested_end_date, NEW.requested_date)
      AND COALESCE(existing.requested_end_date, existing.requested_date) >= NEW.requested_date
  )
BEGIN
  SELECT RAISE(ABORT, 'customer_request_lodging_overlap');
END;

PRAGMA optimize;
