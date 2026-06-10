
DROP POLICY IF EXISTS "members read generated images" ON storage.objects;
CREATE POLICY "members read generated images" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'generated-images'
    AND public.is_workspace_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

DROP POLICY IF EXISTS "members upload generated images" ON storage.objects;
CREATE POLICY "members upload generated images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'generated-images'
    AND public.has_workspace_role(
      (storage.foldername(name))[1]::uuid,
      auth.uid(),
      ARRAY['owner','admin','editor','author']::workspace_role[]
    )
  );

DROP POLICY IF EXISTS "writers delete generated images" ON storage.objects;
CREATE POLICY "writers delete generated images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'generated-images'
    AND public.has_workspace_role(
      (storage.foldername(name))[1]::uuid,
      auth.uid(),
      ARRAY['owner','admin','editor','author']::workspace_role[]
    )
  );
