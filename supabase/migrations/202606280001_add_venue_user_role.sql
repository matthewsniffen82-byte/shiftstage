-- Allow venue operators to create real Dancr auth accounts.

alter type public.user_role add value if not exists 'venue';
