BEGIN;

-- Keep one active MILAN Pay order per user. This closes the race between concurrent
-- authenticated order-create requests. Never auto-fail older orders to satisfy this
-- index: first investigate any existing pending orders and bank transactions manually.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT user_id
      FROM public.payment_orders
     WHERE gateway = 'milanpay'
       AND status = 'pending'
     GROUP BY user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Multiple pending MILAN Pay orders exist for a user. Review orders and bank records, resolve them explicitly, then rerun this migration.';
  END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_one_pending_milanpay_per_user_uidx
  ON public.payment_orders (user_id)
  WHERE gateway = 'milanpay' AND status = 'pending';

COMMIT;
