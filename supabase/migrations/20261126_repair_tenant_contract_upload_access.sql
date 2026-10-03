-- Contract documents use the first storage path segment as the tenant UUID.
-- Allow authenticated tenants to manage files only inside their own folder.
-- The second legacy path shape (contracts/<tenant>/...) remains writable so
-- existing clients can replace old uploads while they are being migrated.
DROP POLICY IF EXISTS "Tenant users manage their contract files" ON storage.objects;
CREATE POLICY "Tenant users manage their contract files"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'contracts'
    AND (
      (storage.foldername(name))[1] = public.get_user_company_id()::text
      OR (
        (storage.foldername(name))[1] = 'contracts'
        AND (storage.foldername(name))[2] = public.get_user_company_id()::text
      )
    )
  )
  WITH CHECK (
    bucket_id = 'contracts'
    AND (
      (storage.foldername(name))[1] = public.get_user_company_id()::text
      OR (
        (storage.foldername(name))[1] = 'contracts'
        AND (storage.foldername(name))[2] = public.get_user_company_id()::text
      )
    )
  );

NOTIFY pgrst, 'reload schema';
