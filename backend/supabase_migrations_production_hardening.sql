-- ============================================================
-- PRODUCTION HARDENING
-- Replaces Phase 2E RPCs with strict business rule validation
-- and includes the missing p_created_by_admin_id parameters.
-- ============================================================


-- 1. ADD CHECK CONSTRAINTS TO ENFORCE INVARIANTS
-- (Assuming they don't already exist or are safe to add)
DO $$
BEGIN
    -- Prevent past bookings at the DB level (using current date based on timezone)
    -- But since this is a check constraint, we use date >= current_date is tricky if dates are backdated.
    -- Better to enforce this purely in the RPC to avoid breaking valid historical data updates.
    
    -- Ensure advance and payment make sense
    ALTER TABLE public.bookings
        ADD CONSTRAINT check_advance_amount 
        CHECK (advance_required <= total_amount);
        
    ALTER TABLE public.bookings
        ADD CONSTRAINT check_balance_amount
        CHECK (balance_amount = greatest(total_amount - amount_paid, 0::numeric));
        
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


-- ============================================================
-- 1. HARDENED OFFLINE / WALK-IN BOOKING
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_offline_booking(
    p_turf_id uuid,
    p_customer_id uuid,
    p_booking_date date,
    p_start_time time,
    p_duration_hours integer,
    p_total_amount numeric,
    p_advance_required numeric,
    p_booking_number text,
    p_payment_amount numeric,
    p_payment_method text,
    p_payment_reference text default null,
    p_notes text default null,
    p_created_by_admin_id uuid default null
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_id uuid;
    v_slot time;
    v_end_time time;
    v_i integer;
    v_turf_open time;
    v_turf_close time;
    v_is_active boolean;
BEGIN

    if p_duration_hours < 1 then
        raise exception 'Duration must be at least 1 hour';
    end if;

    if p_booking_date < current_date then
        raise exception 'Cannot create bookings in the past';
    end if;

    if p_payment_amount < p_advance_required then
        raise exception 'Offline advance payment must be at least %', p_advance_required;
    end if;

    if p_payment_amount > p_total_amount then
        raise exception 'Payment cannot exceed booking total';
    end if;

    if p_payment_method not in ('CASH', 'UPI', 'CARD', 'ONLINE', 'OTHER') then
        raise exception 'Invalid payment method';
    end if;

    -- Validate Turf and Business Hours
    select active, opening_time, closing_time 
    into v_is_active, v_turf_open, v_turf_close
    from public.turf 
    where id = p_turf_id;

    if not found or not v_is_active then
        raise exception 'Turf does not exist or is inactive';
    end if;

    if p_start_time < v_turf_open or 
       (p_start_time + make_interval(hours => p_duration_hours)) > v_turf_close or
       (p_start_time + make_interval(hours => p_duration_hours)) <= p_start_time then
        raise exception 'Booking falls outside of operating hours (% to %)', v_turf_open, v_turf_close;
    end if;

    -- Validate Admin
    if p_created_by_admin_id is not null then
        if not exists (select 1 from public.admin_users where id = p_created_by_admin_id and is_active = true) then
            raise exception 'Invalid or inactive admin ID';
        end if;
    end if;

    -- Remove expired online holds before checking availability.
    perform public.expire_booking_holds();

    -- Create booking.
    insert into public.bookings (
        booking_number,
        turf_id,
        customer_id,
        booking_date,
        start_time,
        end_time,
        duration_hours,
        source,
        booking_status,
        payment_status,
        total_amount,
        advance_required,
        amount_paid,
        balance_amount,
        notes,
        created_by_admin_id
    )
    values (
        p_booking_number,
        p_turf_id,
        p_customer_id,
        p_booking_date,
        p_start_time,
        p_start_time + make_interval(hours => p_duration_hours),
        p_duration_hours,
        'OFFLINE',
        'CONFIRMED',
        'PENDING',
        p_total_amount,
        p_advance_required,
        0,
        p_total_amount,
        p_notes,
        p_created_by_admin_id
    )
    returning id into v_booking_id;

    -- Reserve every individual hour.
    for v_i in 0..(p_duration_hours - 1) loop
        v_slot := p_start_time + make_interval(hours => v_i);
        v_end_time := v_slot + interval '1 hour';

        begin
            insert into public.slot_reservations (
                turf_id, reservation_date, start_time, end_time, status, booking_id
            ) values (
                p_turf_id, p_booking_date, v_slot, v_end_time, 'BOOKED', v_booking_id
            );
        exception
            when unique_violation then
                raise exception 'One or more requested slots are unavailable';
        end;
    end loop;

    -- Record offline advance payment.
    insert into public.payments (
        booking_id, payment_type, payment_method, amount, currency, status, provider, transaction_reference, paid_at
    ) values (
        v_booking_id, 'ADVANCE', p_payment_method, p_payment_amount, 'INR', 'SUCCESS', 'OFFLINE', p_payment_reference, now()
    );

    return v_booking_id;
END;
$$;


-- ============================================================
-- 2. HARDENED EXTEND BOOKING
-- ============================================================

CREATE OR REPLACE FUNCTION public.extend_booking(
    p_booking_id uuid,
    p_added_hours integer,
    p_added_amount numeric,
    p_created_by_admin_id uuid default null
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking public.bookings%rowtype;
    v_slot time;
    v_new_end time;
    v_i integer;
    v_extension_id uuid;
    v_turf_close time;
BEGIN

    if p_added_hours < 1 then
        raise exception 'Extension must be at least 1 hour';
    end if;

    if p_added_amount < 0 then
        raise exception 'Extension amount cannot be negative';
    end if;

    -- Validate Admin
    if p_created_by_admin_id is not null then
        if not exists (select 1 from public.admin_users where id = p_created_by_admin_id and is_active = true) then
            raise exception 'Invalid or inactive admin ID';
        end if;
    end if;

    -- Lock the booking
    select * into v_booking
    from public.bookings
    where id = p_booking_id
    for update;

    if not found then
        raise exception 'Booking not found';
    end if;

    if v_booking.booking_status <> 'CONFIRMED' then
        raise exception 'Only confirmed bookings can be extended';
    end if;

    if v_booking.booking_date < current_date or (v_booking.booking_date = current_date and v_booking.end_time <= current_time) then
        raise exception 'Cannot extend a completed or expired booking';
    end if;

    v_new_end := v_booking.end_time + make_interval(hours => p_added_hours);

    -- Fetch closing time
    select closing_time into v_turf_close
    from public.turf
    where id = v_booking.turf_id;

    if v_new_end > v_turf_close or v_new_end <= v_booking.end_time then
        raise exception 'Extension exceeds turf closing time (%)', v_turf_close;
    end if;

    -- Reserve the additional hours.
    for v_i in 0..(p_added_hours - 1) loop
        v_slot := v_booking.end_time + make_interval(hours => v_i);

        begin
            insert into public.slot_reservations (
                turf_id, reservation_date, start_time, end_time, status, booking_id
            ) values (
                v_booking.turf_id, v_booking.booking_date, v_slot, v_slot + interval '1 hour', 'BOOKED', p_booking_id
            );
        exception
            when unique_violation then
                raise exception 'One or more extension slots are unavailable';
        end;
    end loop;

    -- Record extension.
    insert into public.booking_extensions (
        booking_id, old_end_time, new_end_time, added_hours, added_amount, created_by_admin_id
    ) values (
        p_booking_id, v_booking.end_time, v_new_end, p_added_hours, p_added_amount, p_created_by_admin_id
    ) returning id into v_extension_id;

    -- Increase booking total.
    update public.bookings
    set
        end_time = v_new_end,
        duration_hours = duration_hours + p_added_hours,
        total_amount = total_amount + p_added_amount,
        balance_amount = greatest(total_amount + p_added_amount - amount_paid, 0),
        updated_at = now()
    where id = p_booking_id;

    return v_extension_id;
END;
$$;


-- ============================================================
-- 3. HARDENED BLOCK HOURLY SLOTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.block_booking_slots(
    p_turf_id uuid,
    p_date date,
    p_start_time time,
    p_duration_hours integer,
    p_reason text default 'Maintenance',
    p_created_by_admin_id uuid default null
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_slot time;
    v_i integer;
    v_count integer := 0;
    v_turf_open time;
    v_turf_close time;
    v_is_active boolean;
BEGIN

    if p_duration_hours < 1 then
        raise exception 'Block duration must be at least 1 hour';
    end if;

    if p_date < current_date or (p_date = current_date and p_start_time < current_time) then
        raise exception 'Cannot block time slots in the past';
    end if;

    -- Validate Turf and Business Hours
    select active, opening_time, closing_time 
    into v_is_active, v_turf_open, v_turf_close
    from public.turf 
    where id = p_turf_id;

    if not found or not v_is_active then
        raise exception 'Turf does not exist or is inactive';
    end if;

    if p_start_time < v_turf_open or (p_start_time + make_interval(hours => p_duration_hours)) > v_turf_close then
        raise exception 'Blocked slot falls outside of operating hours (% to %)', v_turf_open, v_turf_close;
    end if;

    -- Validate Admin
    if p_created_by_admin_id is not null then
        if not exists (select 1 from public.admin_users where id = p_created_by_admin_id and is_active = true) then
            raise exception 'Invalid or inactive admin ID';
        end if;
    end if;

    -- Expired holds must not prevent maintenance blocking.
    perform public.expire_booking_holds();

    for v_i in 0..(p_duration_hours - 1) loop
        v_slot := p_start_time + make_interval(hours => v_i);

        begin
            insert into public.slot_reservations (
                turf_id, reservation_date, start_time, end_time, status, block_reason
            ) values (
                p_turf_id, p_date, v_slot, v_slot + interval '1 hour', 'BLOCKED', p_reason
            );

            v_count := v_count + 1;

        exception
            when unique_violation then
                raise exception 'One or more requested slots are already occupied';
        end;
    end loop;

    return v_count;
END;
$$;


-- ============================================================
-- 4. HARDENED UNBLOCK A SLOT
-- ============================================================

CREATE OR REPLACE FUNCTION public.unblock_booking_slot(
    p_reservation_id uuid,
    p_created_by_admin_id uuid default null
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    v_status text;
BEGIN
    -- Validate Admin
    if p_created_by_admin_id is not null then
        if not exists (select 1 from public.admin_users where id = p_created_by_admin_id and is_active = true) then
            raise exception 'Invalid or inactive admin ID';
        end if;
    end if;

    select status into v_status
    from public.slot_reservations
    where id = p_reservation_id
    for update;

    if not found then
        raise exception 'Blocked slot not found';
    end if;

    if v_status <> 'BLOCKED' then
        raise exception 'Only blocked slots can be unblocked';
    end if;

    delete from public.slot_reservations
    where id = p_reservation_id;

    return true;
END;
$$;


-- ============================================================
-- 5. RE-GRANT UPDATED FUNCTIONS TO SERVICE ROLE
-- ============================================================

GRANT EXECUTE ON FUNCTION public.create_offline_booking(uuid, uuid, date, time, integer, numeric, numeric, text, numeric, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.extend_booking(uuid, integer, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_booking_slots(uuid, date, time, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.unblock_booking_slot(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
