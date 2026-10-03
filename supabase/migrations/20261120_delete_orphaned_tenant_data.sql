-- Extend platform-admin deletion to handle orphaned tenant data. Some existing
-- rows retain a company_id even though the parent public.companies row is gone.
-- If the parent exists, deleting it uses the normal FK cascades. If it is
-- missing, delete directly scoped public rows in FK dependency order.
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
    RAISE EXCEPTION 'Access Denied: Super Admin privilege required';
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

    -- Delete referencing tables before referenced tables. Rows without a
    -- direct company_id are left to their declared FK cascade behavior.
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

REVOKE ALL ON FUNCTION public.admin_delete_company(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_company(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
