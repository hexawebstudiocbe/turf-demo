-- ============================================================
-- TURFBOOK - PHASE 2E
-- Admin bookings / offline payments / extensions / blocking
-- ============================================================


-- ============================================================
-- 1. OFFLINE / WALK-IN BOOKING
--
-- Creates:
--   customer
--   booking
--   hourly reservations
--   advance payment
--
-- Everything happens in ONE database transaction.
-- ============================================================

create or replace function public.create_offline_booking(
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
    p_notes text default null
)
returns uuid
language plpgsql
as $$
declare
    v_booking_id uuid;
    v_slot time;
    v_end_time time;
    v_i integer;
begin

    if p_duration_hours < 1 then
        raise exception 'Duration must be at least 1 hour';
    end if;

    if p_payment_amount < p_advance_required then
        raise exception
            'Offline advance payment must be at least %',
            p_advance_required;
    end if;

    if p_payment_amount > p_total_amount then
        raise exception
            'Payment cannot exceed booking total';
    end if;

    if p_payment_method not in (
        'CASH',
        'UPI',
        'CARD',
        'ONLINE',
        'OTHER'
    ) then
        raise exception 'Invalid payment method';
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
        notes
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
        p_notes
    )
    returning id into v_booking_id;


    -- Reserve every individual hour.
    for v_i in 0..(p_duration_hours - 1) loop

        v_slot :=
            p_start_time
            + make_interval(hours => v_i);

        v_end_time :=
            v_slot + interval '1 hour';

        begin

            insert into public.slot_reservations (
                turf_id,
                reservation_date,
                start_time,
                end_time,
                status,
                booking_id
            )
            values (
                p_turf_id,
                p_booking_date,
                v_slot,
                v_end_time,
                'BOOKED',
                v_booking_id
            );

        exception
            when unique_violation then
                raise exception
                    'One or more requested slots are unavailable';
        end;

    end loop;


    -- Record offline advance payment.
    insert into public.payments (
        booking_id,
        payment_type,
        payment_method,
        amount,
        currency,
        status,
        provider,
        transaction_reference,
        paid_at
    )
    values (
        v_booking_id,
        'ADVANCE',
        p_payment_method,
        p_payment_amount,
        'INR',
        'SUCCESS',
        'OFFLINE',
        p_payment_reference,
        now()
    );

    return v_booking_id;
end;
$$;


-- ============================================================
-- 2. EXTEND EXISTING BOOKING
--
-- Adds complete one-hour slots immediately after the current
-- booking end time.
--
-- The caller supplies the server-calculated added amount.
-- ============================================================

create or replace function public.extend_booking(
    p_booking_id uuid,
    p_added_hours integer,
    p_added_amount numeric
)
returns uuid
language plpgsql
as $$
declare
    v_booking public.bookings%rowtype;
    v_slot time;
    v_new_end time;
    v_i integer;
    v_extension_id uuid;
begin

    if p_added_hours < 1 then
        raise exception
            'Extension must be at least 1 hour';
    end if;

    if p_added_amount < 0 then
        raise exception
            'Extension amount cannot be negative';
    end if;


    -- Lock the booking so two admins cannot extend it
    -- simultaneously.
    select *
    into v_booking
    from public.bookings
    where id = p_booking_id
    for update;


    if not found then
        raise exception 'Booking not found';
    end if;


    if v_booking.booking_status not in (
        'CONFIRMED'
    ) then
        raise exception
            'Only confirmed bookings can be extended';
    end if;


    v_new_end :=
        v_booking.end_time
        + make_interval(hours => p_added_hours);


    -- Reserve the additional hours.
    for v_i in 0..(p_added_hours - 1) loop

        v_slot :=
            v_booking.end_time
            + make_interval(hours => v_i);

        begin

            insert into public.slot_reservations (
                turf_id,
                reservation_date,
                start_time,
                end_time,
                status,
                booking_id
            )
            values (
                v_booking.turf_id,
                v_booking.booking_date,
                v_slot,
                v_slot + interval '1 hour',
                'BOOKED',
                p_booking_id
            );

        exception
            when unique_violation then
                raise exception
                    'One or more extension slots are unavailable';
        end;

    end loop;


    -- Record extension.
    insert into public.booking_extensions (
        booking_id,
        old_end_time,
        new_end_time,
        added_hours,
        added_amount
    )
    values (
        p_booking_id,
        v_booking.end_time,
        v_new_end,
        p_added_hours,
        p_added_amount
    )
    returning id into v_extension_id;


    -- Increase booking total.
    update public.bookings
    set
        end_time = v_new_end,
        duration_hours =
            duration_hours + p_added_hours,
        total_amount =
            total_amount + p_added_amount,
        balance_amount =
            greatest(
                total_amount + p_added_amount - amount_paid,
                0
            ),
        updated_at = now()
    where id = p_booking_id;


    return v_extension_id;
end;
$$;


-- ============================================================
-- 3. BLOCK HOURLY SLOTS
--
-- If any requested hour is already booked/held/blocked,
-- the entire operation fails.
-- ============================================================

create or replace function public.block_booking_slots(
    p_turf_id uuid,
    p_date date,
    p_start_time time,
    p_duration_hours integer,
    p_reason text default 'Maintenance'
)
returns integer
language plpgsql
as $$
declare
    v_slot time;
    v_i integer;
    v_count integer := 0;
begin

    if p_duration_hours < 1 then
        raise exception
            'Block duration must be at least 1 hour';
    end if;


    -- Expired holds must not prevent maintenance blocking.
    perform public.expire_booking_holds();


    for v_i in 0..(p_duration_hours - 1) loop

        v_slot :=
            p_start_time
            + make_interval(hours => v_i);

        begin

            insert into public.slot_reservations (
                turf_id,
                reservation_date,
                start_time,
                end_time,
                status,
                block_reason
            )
            values (
                p_turf_id,
                p_date,
                v_slot,
                v_slot + interval '1 hour',
                'BLOCKED',
                p_reason
            );

            v_count := v_count + 1;

        exception
            when unique_violation then
                raise exception
                    'One or more requested slots are already occupied';
        end;

    end loop;

    return v_count;
end;
$$;


-- ============================================================
-- 4. UNBLOCK A SLOT
-- ============================================================

create or replace function public.unblock_booking_slot(
    p_reservation_id uuid
)
returns boolean
language plpgsql
as $$
declare
    v_status text;
begin

    select status
    into v_status
    from public.slot_reservations
    where id = p_reservation_id
    for update;

    if not found then
        raise exception 'Blocked slot not found';
    end if;

    if v_status <> 'BLOCKED' then
        raise exception
            'Only blocked slots can be unblocked';
    end if;

    delete from public.slot_reservations
    where id = p_reservation_id;

    return true;
end;
$$;


-- ============================================================
-- 5. GRANT FUNCTIONS TO SERVICE ROLE
-- ============================================================

grant execute on function public.create_offline_booking(
    uuid,
    uuid,
    date,
    time,
    integer,
    numeric,
    numeric,
    text,
    numeric,
    text,
    text,
    text
) to service_role;

grant execute on function public.extend_booking(
    uuid,
    integer,
    numeric
) to service_role;

grant execute on function public.block_booking_slots(
    uuid,
    date,
    time,
    integer,
    text
) to service_role;

grant execute on function public.unblock_booking_slot(
    uuid
) to service_role;
