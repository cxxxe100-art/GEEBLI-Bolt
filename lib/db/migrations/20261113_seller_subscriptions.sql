ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

DO $$ BEGIN
  CREATE TYPE public.subscription_payment_method AS ENUM ('bankak', 'fawry', 'cash');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_payment_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.subscription_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_amount numeric(12,2) NOT NULL DEFAULT 0,
  recipient_name text NOT NULL DEFAULT '',
  bankak_account text NOT NULL DEFAULT '',
  fawry_account text NOT NULL DEFAULT '',
  cash_instructions text NOT NULL DEFAULT '',
  earnings_reset_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_subscriptions (
  id serial PRIMARY KEY,
  seller_id integer NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  payment_method public.subscription_payment_method NOT NULL,
  receipt_path text NOT NULL,
  status public.subscription_payment_status NOT NULL DEFAULT 'pending',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewer_clerk_user_id text,
  review_note text,
  period_start timestamptz,
  period_end timestamptz
);

CREATE INDEX IF NOT EXISTS seller_subscriptions_seller_id_idx ON public.seller_subscriptions (seller_id);
CREATE INDEX IF NOT EXISTS seller_subscriptions_status_submitted_at_idx ON public.seller_subscriptions (status, submitted_at DESC);

ALTER TABLE public.subscription_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_settings, public.seller_subscriptions FROM anon, authenticated;
GRANT ALL ON public.subscription_settings, public.seller_subscriptions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seller_subscriptions_id_seq TO service_role;
