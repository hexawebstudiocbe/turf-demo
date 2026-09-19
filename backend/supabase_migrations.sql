create or replace function public.confirm_booking(
    p_booking_id uuid
)
returns void
language plpgsql
as $$
declare
    v_status text;
    v_expiry timestamptz;
begin

    select
        booking_status,
        hold_expires_at
    into
        v_status,
        v_expiry
    from public.bookings
    where id = p_booking_id
    for update;

    if not found then
        raise exception 'Booking not found';
    end if;

    if v_status in ('CONFIRMED', 'COMPLETED') then
        return;
    end if;

    if v_status <> 'HELD' then
        raise exception
            'Booking cannot be confirmed from status %',
            v_status;
    end if;

    if v_expiry is not null
       and v_expiry <= now() then

        delete from public.slot_reservations
        where booking_id = p_booking_id
          and status = 'HOLD';

        update public.bookings
        set
            booking_status = 'EXPIRED',
            payment_status = 'FAILED',
            updated_at = now()
        where id = p_booking_id;

        raise exception
            'Booking hold has expired';
    end if;

    update public.slot_reservations
    set
        status = 'BOOKED',
        hold_expires_at = null,
        updated_at = now()
    where booking_id = p_booking_id
      and status = 'HOLD';

    update public.bookings
    set
        booking_status = 'CONFIRMED',
        payment_status = 'PARTIAL',
        updated_at = now()
    where id = p_booking_id;

end;
$$;


create or replace function public.expire_booking_holds()
returns integer
language plpgsql
as $$
declare
    v_count integer;
begin

    delete from public.slot_reservations
    where status = 'HOLD'
      and hold_expires_at <= now();

    get diagnostics v_count = row_count;

    update public.bookings
    set
        booking_status = 'EXPIRED',
        payment_status = 'FAILED',
        updated_at = now()
    where booking_status = 'HELD'
      and hold_expires_at <= now();

    return v_count;
end;
$$;
