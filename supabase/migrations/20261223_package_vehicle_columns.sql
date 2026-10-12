-- The package owner chooses how many vehicle price columns the package is priced in, and
-- which vehicle sizes each column shows, when the package is created. Stored here so the
-- builder grid and the exported presentation always show the same columns.
alter table public.packages add column if not exists vehicle_columns jsonb;