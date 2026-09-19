-- ============================================================
-- Phase 2G: Reviews migration
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    turf_id uuid NOT NULL
        REFERENCES public.turf(id)
        ON DELETE CASCADE,

    customer_name text NOT NULL,

    rating integer NOT NULL
        CHECK (rating >= 1 AND rating <= 5),

    comment text NOT NULL,

    is_verified_booking boolean NOT NULL DEFAULT true,

    is_approved boolean NOT NULL DEFAULT true,

    created_at timestamptz NOT NULL DEFAULT now(),

    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_turf_id
    ON public.reviews(turf_id);

CREATE INDEX IF NOT EXISTS idx_reviews_turf_approved_created
    ON public.reviews(turf_id, is_approved, created_at DESC);

DROP TRIGGER IF EXISTS reviews_set_updated_at
    ON public.reviews;

CREATE TRIGGER reviews_set_updated_at
BEFORE UPDATE ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
