-- Authorization takes row locks to serialize with reviewer revocation. PostgREST
-- runs STABLE RPCs in read-only transactions, which cannot acquire those locks.
-- Keep the authorization and grants intact and allow a read-write RPC transaction.
alter function public.get_media_batch(uuid, text, uuid) volatile;

notify pgrst, 'reload schema';
