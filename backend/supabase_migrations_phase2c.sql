alter table public.turf
add column if not exists gallery jsonb not null default '[]'::jsonb;

alter table public.turf
add column if not exists default_price numeric(12,2);

alter table public.turf
add column if not exists opening_time time;

alter table public.turf
add column if not exists closing_time time;

alter table public.turf
add column if not exists maps_url text;

update public.turf t
set
    opening_time = bh.open_time,
    closing_time = bh.close_time
from public.business_hours bh
where bh.turf_id = t.id
  and bh.day_of_week = 1;
