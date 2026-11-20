UPDATE public.roles
SET access = access || '{"clients":"read","series":"read","tariffs":"none"}'::jsonb
WHERE is_builtin
  AND key IN ('consultant');

UPDATE public.roles
SET flags = flags || '{"view_all_itineraries":false}'::jsonb
WHERE is_builtin;

NOTIFY pgrst, 'reload schema';
