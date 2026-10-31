-- READ-ONLY pending-order audit for legacy MILAN Pay and Cashfree.
-- Run before resolving duplicates or applying either pending-order index migration.
-- This script changes no data.

WITH request_summary AS (
  SELECT
    order_id,
    COUNT(*)::integer AS request_count,
    STRING_AGG(DISTINCT status, ', ' ORDER BY status) AS request_statuses,
    BOOL_OR(NULLIF(BTRIM(utr), '') IS NOT NULL) AS has_submitted_utr
  FROM public.storage_upgrade_requests
  WHERE order_id IS NOT NULL
  GROUP BY order_id
)
SELECT
  p.user_id,
  p.order_id,
  p.gateway,
  p.plan,
  p.amount_inr,
  p.created_at,
  ROUND((EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0)::numeric, 2) AS pending_hours,
  p.status,
  (p.gateway_reference IS NOT NULL) AS recipient_reference_is_set,
  COALESCE(r.request_count, 0) AS linked_request_count,
  COALESCE(r.request_statuses, 'none') AS linked_request_statuses,
  COALESCE(r.has_submitted_utr, FALSE) AS has_submitted_utr
FROM public.payment_orders AS p
LEFT JOIN request_summary AS r ON r.order_id = p.order_id
WHERE p.gateway IN ('milanpay', 'cashfree')
  AND p.status = 'pending'
ORDER BY p.user_id, p.created_at;

-- Second result set: duplicate groups block the corresponding per-gateway unique index.
SELECT
  gateway,
  user_id,
  COUNT(*)::integer AS pending_order_count,
  ARRAY_AGG(order_id ORDER BY created_at) AS order_ids,
  MIN(created_at) AS oldest_order_at,
  MAX(created_at) AS newest_order_at
FROM public.payment_orders
WHERE gateway IN ('milanpay', 'cashfree')
  AND status = 'pending'
GROUP BY gateway, user_id
HAVING COUNT(*) > 1
ORDER BY pending_order_count DESC, gateway, user_id;
