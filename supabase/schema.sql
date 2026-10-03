-- ==========================================
-- RESET SCRIPT FOR TOURBUILDER
-- This script wipes and recreates the schema
-- ==========================================

-- 1. Drop existing triggers and functions
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user_registration() CASCADE;
DROP FUNCTION IF EXISTS public.is_super_admin() CASCADE;
DROP FUNCTION IF EXISTS public.register_new_company(TEXT, TEXT, TEXT) CASCADE;

-- 2. Drop existing tables with CASCADE (wipes all data)
DROP TABLE IF EXISTS public.item_rates CASCADE;
DROP TABLE IF EXISTS public.library_items CASCADE;
DROP TABLE IF EXISTS public.suppliers CASCADE;
DROP TABLE IF EXISTS public.invitations CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;

-- 3. Recreate Companies Table
CREATE TABLE public.companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    telephone TEXT,
    owner_id UUID REFERENCES auth.users(id),
    pricing_plan TEXT DEFAULT 'Basic',
    payment_status TEXT DEFAULT 'paid' CHECK (payment_status IN ('paid', 'non-payment', 'active')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Recreate Profiles Table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    user_role TEXT NOT NULL DEFAULT 'consultant' CHECK (user_role IN ('admin', 'consultant', 'finance', 'super_admin')),
    is_super_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Recreate Invitations Table
CREATE TABLE public.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'expired')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Recreate Suppliers Table
CREATE TABLE public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT,
    email TEXT,
    phone TEXT,
    website TEXT,
    contact_person TEXT,
    address TEXT,
    country TEXT,
    province_state TEXT,
    city TEXT,
    city_location TEXT,
    physical_address TEXT,
    bank_name TEXT,
    account_holder_name TEXT,
    bank_account_number TEXT,
    branch_code TEXT,
    swift_code TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Recreate Library Items Table
CREATE TABLE public.library_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    sub_category TEXT,
    description TEXT,
    location TEXT,
    destination_area TEXT,
    currency TEXT DEFAULT 'ZAR',
    pricing_model TEXT DEFAULT 'per_person',
    max_occupancy INTEGER DEFAULT 2,
    max_adults INTEGER DEFAULT 2,
    max_children INTEGER DEFAULT 2,
    sharing_capacity_rules JSONB DEFAULT '[]'::jsonb,
    child_age_ranges JSONB DEFAULT '[]'::jsonb,
    images JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Recreate Item Rates Table
CREATE TABLE public.item_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
    option_name TEXT DEFAULT 'Base Season',
    room_type TEXT,
    meal_plan TEXT,
    unit_cost NUMERIC(12, 2) DEFAULT 0,
    unit_price NUMERIC(12, 2) DEFAULT 0,
    currency TEXT DEFAULT 'ZAR',
    season_name TEXT DEFAULT 'Base Season',
    valid_from DATE,
    valid_to DATE,
    price_1_adult NUMERIC(12, 2) DEFAULT 0,
    price_2_adults NUMERIC(12, 2) DEFAULT 0,
    price_3_plus_adults NUMERIC(12, 2) DEFAULT 0,
    price_child_0_1 NUMERIC(12, 2) DEFAULT 0,
    price_child_0_5 NUMERIC(12, 2) DEFAULT 0,
    price_child_2_11 NUMERIC(12, 2) DEFAULT 0,
    price_child_6_11 NUMERIC(12, 2) DEFAULT 0,
    price_child_12_17 NUMERIC(12, 2) DEFAULT 0,
    price_child_12_18 NUMERIC(12, 2) DEFAULT 0,
    single_supplement NUMERIC(12, 2) DEFAULT 0,
    child_discount NUMERIC(12, 2) DEFAULT 0,
    single_room_rate NUMERIC(12, 2) DEFAULT 0,
    double_twin_rate NUMERIC(12, 2) DEFAULT 0,
    effective_single_rate NUMERIC(12, 2) DEFAULT 0,
    rate_basis TEXT DEFAULT 'per_person_sharing',
    child_sharing_policy TEXT DEFAULT 'sharing_with_adults',
    child_rates_breakdown JSONB DEFAULT '{}'::jsonb,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Enable RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_rates ENABLE ROW LEVEL SECURITY;

-- 7. Helper Function for RLS
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_super_admin = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RPC Function for Registration (Alternative to Triggers)
-- This is called from the frontend after a successful signup
CREATE OR REPLACE FUNCTION public.register_new_company(
    company_name TEXT,
    company_phone TEXT,
    user_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_company_id UUID;
    result JSONB;
BEGIN
    -- 1. Create the company
    INSERT INTO public.companies (name, telephone, status, owner_id)
    VALUES (company_name, company_phone, 'pending', auth.uid())
    RETURNING id INTO new_company_id;

    -- 2. Create the profile
    INSERT INTO public.profiles (id, company_id, first_name, last_name, user_role)
    VALUES (
        auth.uid(),
        new_company_id,
        split_part(user_full_name, ' ', 1),
        split_part(user_full_name, ' ', 2),
        'admin'
    );

    SELECT jsonb_build_object('success', true, 'company_id', new_company_id) INTO result;
    RETURN result;
EXCEPTION WHEN OTHERS THEN
    SELECT jsonb_build_object('success', false, 'error', SQLERRM) INTO result;
    RETURN result;
END;
$$;

-- 10. Super Admin Utility Functions

-- Get platform-wide statistics
CREATE OR REPLACE FUNCTION public.get_platform_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_companies', (SELECT count(*) FROM public.companies),
        'pending_approvals', (SELECT count(*) FROM public.companies WHERE status = 'pending'),
        'total_users', (SELECT count(*) FROM public.profiles),
        'active_invitations', (SELECT count(*) FROM public.invitations WHERE status = 'pending'),
        'total_revenue_est', (
            SELECT COALESCE(SUM(
                CASE 
                    WHEN pricing_plan = 'Premium' THEN 99 
                    WHEN pricing_plan = 'Standard' THEN 49 
                    ELSE 0 
                END
            ), 0) FROM public.companies WHERE payment_status = 'paid'
        )
    ) INTO result;
    RETURN result;
END;
$$;

-- Admin function to delete a company and its users
CREATE OR REPLACE FUNCTION public.admin_delete_company(target_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    company_user_ids UUID[];
    company_exists BOOLEAN;
    affected_rows BIGINT := 0;
    current_table_oid OID;
    current_table_name TEXT;
    deleted_rows BIGINT;
BEGIN
    IF auth.uid() IS NULL OR (
        lower(COALESCE(auth.jwt() ->> 'email', '')) <> lower('info.olaafricatravel@gmail.com')
        AND NOT public.is_super_admin()
    ) THEN
        RAISE EXCEPTION 'Access Denied';
    END IF;

    IF target_company_id IS NULL THEN
        RAISE EXCEPTION 'A company UUID is required';
    END IF;

    SELECT array_agg(id)
    INTO company_user_ids
    FROM public.profiles
    WHERE company_id = target_company_id;

    SELECT EXISTS (
        SELECT 1 FROM public.companies WHERE id = target_company_id
    ) INTO company_exists;

    IF company_exists THEN
        -- Delete the company before its auth users because owner_id has no cascade.
        DELETE FROM public.companies WHERE id = target_company_id;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT;
        affected_rows := affected_rows + deleted_rows;
    ELSE
        CREATE TEMP TABLE admin_company_delete_work (
            table_oid OID PRIMARY KEY,
            qualified_name TEXT NOT NULL,
            processed BOOLEAN NOT NULL DEFAULT false
        ) ON COMMIT DROP;

        INSERT INTO pg_temp.admin_company_delete_work (table_oid, qualified_name)
        SELECT DISTINCT c.oid, format('%I.%I', n.nspname, c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname <> 'companies'
          AND a.attname = 'company_id'
          AND a.atttypid = 'uuid'::regtype
          AND a.attnum > 0
          AND NOT a.attisdropped;

        LOOP
            current_table_oid := NULL;
            current_table_name := NULL;

            SELECT work.table_oid, work.qualified_name
            INTO current_table_oid, current_table_name
            FROM pg_temp.admin_company_delete_work work
            WHERE NOT work.processed
              AND NOT EXISTS (
                SELECT 1
                FROM pg_constraint fk
                JOIN pg_temp.admin_company_delete_work child
                  ON child.table_oid = fk.conrelid
                WHERE fk.contype = 'f'
                  AND fk.confrelid = work.table_oid
                  AND child.table_oid <> work.table_oid
                  AND NOT child.processed
              )
            ORDER BY work.qualified_name
            LIMIT 1;

            IF current_table_oid IS NULL THEN
                IF EXISTS (SELECT 1 FROM pg_temp.admin_company_delete_work WHERE NOT processed) THEN
                    RAISE EXCEPTION 'Could not safely order tenant table cleanup because of a foreign-key cycle';
                END IF;
                EXIT;
            END IF;

            EXECUTE format('DELETE FROM %s WHERE company_id = $1', current_table_name)
                USING target_company_id;
            GET DIAGNOSTICS deleted_rows = ROW_COUNT;
            affected_rows := affected_rows + deleted_rows;

            UPDATE pg_temp.admin_company_delete_work
            SET processed = true
            WHERE table_oid = current_table_oid;
        END LOOP;
    END IF;

    IF company_user_ids IS NOT NULL THEN
        DELETE FROM auth.users WHERE id = ANY(company_user_ids);
    END IF;

    IF affected_rows = 0 THEN
        RAISE EXCEPTION 'No company or company-scoped records were found for UUID %', target_company_id;
    END IF;

    RETURN true;
END;
$$;

-- Function to redeem an invitation (called during registration)
CREATE OR REPLACE FUNCTION public.redeem_invitation(inv_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.invitations
    SET status = 'redeemed'
    WHERE code = inv_code AND status = 'pending';
    
    RETURN FOUND;
END;
$$;




-- 9. RLS Policies

-- Profiles: Users can see their own
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);

-- Companies: Users can see their own
CREATE POLICY "Users can view own company" ON public.companies FOR SELECT USING (
    auth.uid() = owner_id 
    OR 
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.company_id = public.companies.id)
);

-- Super Admin: Full Access
CREATE POLICY "Super admins can manage all profiles" ON public.profiles FOR ALL USING (public.is_super_admin());
CREATE POLICY "Super admins can manage all companies" ON public.companies FOR ALL USING (public.is_super_admin());
CREATE POLICY "Super admins can manage invitations" ON public.invitations FOR ALL USING (public.is_super_admin());

-- Invitations: Public read by code
CREATE POLICY "Anyone can read invitation by code" ON public.invitations FOR SELECT USING (true);

-- Helper function to check user's company ID
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Suppliers: Users can manage suppliers belonging to their company
CREATE POLICY "Users can view company suppliers" ON public.suppliers 
    FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
CREATE POLICY "Users can insert company suppliers" ON public.suppliers 
    FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
CREATE POLICY "Users can update company suppliers" ON public.suppliers 
    FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
CREATE POLICY "Users can delete company suppliers" ON public.suppliers 
    FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());

-- Library Items: Users can manage library items belonging to their company
CREATE POLICY "Users can view company library items" ON public.library_items 
    FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
CREATE POLICY "Users can insert company library items" ON public.library_items 
    FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
CREATE POLICY "Users can update company library items" ON public.library_items 
    FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
CREATE POLICY "Users can delete company library items" ON public.library_items 
    FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());

-- Item Rates: Access tied to parent item's company ownership
CREATE POLICY "Users can view company item rates" ON public.item_rates 
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.library_items 
            WHERE library_items.id = item_rates.item_id 
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
    );
CREATE POLICY "Users can insert company item rates" ON public.item_rates 
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.library_items 
            WHERE library_items.id = item_rates.item_id 
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
    );
CREATE POLICY "Users can update company item rates" ON public.item_rates 
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.library_items 
            WHERE library_items.id = item_rates.item_id 
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
    );
CREATE POLICY "Users can delete company item rates" ON public.item_rates 
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.library_items 
            WHERE library_items.id = item_rates.item_id 
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
    );

-- 11. Super Admin Functions & Access Control
-- Replaces insecure view public.company_admin_details which exposed auth.users to PostgREST

DROP VIEW IF EXISTS public.company_admin_details;

CREATE OR REPLACE FUNCTION public.get_company_admin_details()
RETURNS TABLE (
    company_id UUID,
    company_name TEXT,
    first_name TEXT,
    last_name TEXT,
    user_role TEXT,
    admin_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- Enforce Super Admin authorization check
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access Denied: Super Admin privilege required';
    END IF;

    RETURN QUERY
    SELECT 
        c.id as company_id,
        c.name as company_name,
        p.first_name,
        p.last_name,
        p.user_role,
        u.email::TEXT as admin_email
    FROM public.companies c
    JOIN public.profiles p ON c.id = p.company_id
    JOIN auth.users u ON p.id = u.id
    WHERE p.user_role = 'admin';
END;
$$;
