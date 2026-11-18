-- Migration 011: Add member phone column
-- Bid2Build: Permanent Captain and Member Mobile Number Storage
-- Adds phone TEXT column to public.members safely without disturbing existing records or policies.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.members.phone IS 'Contact mobile number for the member/captain, stored as text to preserve leading zeros and country codes.';
