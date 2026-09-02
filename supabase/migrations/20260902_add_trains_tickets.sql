-- =============================================================================
-- Migration: Add "Trains" and "Tickets" library categories
-- For databases where library_categories is already seeded, the seed migration's
-- INSERT ... ON CONFLICT DO NOTHING would not add new categories — this adds them.
-- =============================================================================

INSERT INTO public.library_categories (name, icon, color, sort_order) VALUES
    ('Trains',   'TrainFront', '#f97316', 7),
    ('Tickets',  'Ticket',     '#14b8a6', 8)
ON CONFLICT (name) DO NOTHING;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';