-- Library categories: reference table seeded with the library item categories
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)

CREATE TABLE IF NOT EXISTS public.library_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    icon TEXT,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.library_categories ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read the shared category list
CREATE POLICY "Users can read library categories" ON public.library_categories
    FOR SELECT USING (auth.role() = 'authenticated' OR public.is_super_admin());

-- Only super admins can change the category list
CREATE POLICY "Super admins can manage library categories" ON public.library_categories
    FOR ALL USING (public.is_super_admin());

-- Seed the 10 categories (idempotent). NOTE: entrance fees and conservation
-- levies are no longer standalone categories — they are surcharge options on
-- Accommodation / Transfers items (see 20260829_surcharge_fees.sql).
INSERT INTO public.library_categories (name, icon, color, sort_order) VALUES
    ('Accommodation',        'Hotel',     '#863bff', 1),
    ('Transfers',            'Bus',       '#3b82f6', 2),
    ('Activities / Tours',   'Compass',   '#10b981', 3),
    ('Flights / Charter',    'Plane',     '#6366f1', 4),
    ('Meals',                'Utensils',  '#f59e0b', 5),
    ('Guide / Driver',       'UserCheck', '#8b5cf6', 6),
    ('Extras',               'Sparkles',  '#ec4899', 7),
    ('Car Rental',           'Car',       '#06b6d4', 8)
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';