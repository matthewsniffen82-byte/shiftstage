-- Dancer-facing engagement activity from anonymous likes, follows, and shares.

alter type public.notification_type add value if not exists 'engagement';
