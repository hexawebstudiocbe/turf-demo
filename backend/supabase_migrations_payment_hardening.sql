-- ============================================================
-- PHASE 3: PAYMENT IDEMPOTENCY HARDENING
-- Adds payment confirmation RPC and unique ledger constraint
-- ============================================================

-- 1. ADD UNIQUE CONSTRAINT
DO $$
BEGIN
    ALTER TABLE public.payments
        ADD CONSTRAINT unique_provider_payment_id
        UNIQUE (provider_payment_id);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


-- ============================================================
-- 2. CONFIRM ONLINE PAYMENT RPC
-- Atomic confirmation, ledger insertion, and idempotency check
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_online_payment(
  p_order_id text,
  p_payment_id text,
  p_provider text,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_existing_payment public.payments%ROWTYPE;
  v_new_amount_paid numeric;
BEGIN
  IF p_order_id IS NULL OR trim(p_order_id) = '' THEN
    RAISE EXCEPTION 'Payment order ID is required';
  END IF;

  IF p_payment_id IS NULL OR trim(p_payment_id) = '' THEN
    RAISE EXCEPTION 'Payment ID is required';
  END IF;

  IF p_provider IS NULL OR trim(p_provider) = '' THEN
    RAISE EXCEPTION 'Payment provider is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  /*
   * Idempotency at the payment level.
   * This also handles a repeated webhook for an already-recorded payment.
   */
  SELECT *
  INTO v_existing_payment
  FROM public.payments
  WHERE provider_payment_id = p_payment_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'booking_id', v_existing_payment.booking_id
    );
  END IF;

  /*
   * Lock the booking so two simultaneous confirmations cannot
   * both confirm/update the same booking.
   */
  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE razorpay_order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found for payment order';
  END IF;

  /*
   * A previously completed/confirmed booking is already successful.
   */
  IF v_booking.booking_status IN ('CONFIRMED', 'COMPLETED') THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'booking_id', v_booking.id
    );
  END IF;

  IF v_booking.booking_status = 'EXPIRED' THEN
    RAISE EXCEPTION 'Booking hold has expired';
  END IF;

  IF v_booking.booking_status <> 'HELD' THEN
    RAISE EXCEPTION 'Booking is not awaiting online payment';
  END IF;

  /*
   * The payment must correspond to the booking's required advance.
   */
  IF p_amount <> v_booking.advance_required THEN
    RAISE EXCEPTION
      'Payment amount mismatch: expected %, received %',
      v_booking.advance_required,
      p_amount;
  END IF;

  v_new_amount_paid := COALESCE(v_booking.amount_paid, 0) + p_amount;

  UPDATE public.bookings
  SET
    booking_status = 'CONFIRMED',
    payment_status = CASE
      WHEN v_new_amount_paid >= total_amount THEN 'PAID'
      ELSE 'PARTIAL'
    END,
    amount_paid = v_new_amount_paid,
    balance_amount = total_amount - v_new_amount_paid,
    razorpay_payment_id = p_payment_id,
    hold_expires_at = NULL,
    updated_at = now()
  WHERE id = v_booking.id;

  INSERT INTO public.payments (
    booking_id,
    payment_type,
    payment_method,
    amount,
    currency,
    provider,
    provider_order_id,
    provider_payment_id,
    status,
    paid_at
  )
  VALUES (
    v_booking.id,
    'ADVANCE',
    'ONLINE',
    p_amount,
    'INR',
    p_provider,
    p_order_id,
    p_payment_id,
    'SUCCESS',
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'booking_id', v_booking.id,
    'amount_paid', v_new_amount_paid,
    'balance_amount', v_booking.total_amount - v_new_amount_paid
  );
END;
$$;


-- ============================================================
-- 3. GRANT EXECUTE TO SERVICE ROLE
-- ============================================================

GRANT EXECUTE ON FUNCTION public.confirm_online_payment(text, text, text, numeric) TO service_role;

NOTIFY pgrst, 'reload schema';
