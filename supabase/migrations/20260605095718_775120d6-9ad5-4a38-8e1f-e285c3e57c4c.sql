
CREATE POLICY "Users read own media"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own media"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);
