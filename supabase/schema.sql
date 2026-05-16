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

-- 6. Enable RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

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
AS $$
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access Denied';
    END IF;
    
    -- 1. Delete all auth users associated with this company
    -- Profiles table handles the link between auth.users and companies
    DELETE FROM auth.users 
    WHERE id IN (
        SELECT id FROM public.profiles 
        WHERE company_id = target_company_id
    );

    -- 2. Delete the company itself
    -- (Note: profiles will be deleted via ON DELETE CASCADE from auth.users)
    DELETE FROM public.companies WHERE id = target_company_id;
    
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

-- 11. Views for Super Admin

-- View to see company admins with their emails
-- Note: auth.users is not directly joinable in some environments without service role, 
-- so we rely on profiles having the email or using a security definer function.
CREATE OR REPLACE VIEW public.company_admin_details AS
SELECT 
    c.id as company_id,
    c.name as company_name,
    p.first_name,
    p.last_name,
    p.user_role,
    u.email as admin_email
FROM public.companies c
JOIN public.profiles p ON c.id = p.company_id
JOIN auth.users u ON p.id = u.id
WHERE p.user_role = 'admin';

-- Ensure Super Admin can read this view
GRANT SELECT ON public.company_admin_details TO authenticated;
-- Note: RLS on the underlying tables will still apply unless the view is security definer.
-- For simplicity in this demo, we'll keep it as a standard view.

