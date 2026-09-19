-- ============================================================
-- TURFBOOK - PHASE 2C REPAIR
-- ============================================================

ALTER TABLE public.turf
  ADD COLUMN IF NOT EXISTS gallery jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS default_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS opening_time time,
  ADD COLUMN IF NOT EXISTS closing_time time,
  ADD COLUMN IF NOT EXISTS maps_url text;

UPDATE public.turf t
SET
  opening_time = bh.open_time,
  closing_time = bh.close_time,
  updated_at = now()
FROM public.business_hours bh
WHERE bh.turf_id = t.id
  AND bh.day_of_week = 1;

NOTIFY pgrst, 'reload schema';
