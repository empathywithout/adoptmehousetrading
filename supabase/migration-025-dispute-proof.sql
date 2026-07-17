-- Add structured proof fields to build_registry_disputes.
-- proof_url: required external evidence link (YouTube, Streamable, TikTok, Reddit, etc.)
-- dispute_type: what the disputer is actually claiming

alter table build_registry_disputes
  add column if not exists proof_url text,
  add column if not exists dispute_type text
    check (dispute_type in ('i_am_original', 'this_is_speedbuild', 'this_is_clone', 'other'));

-- Also add proof_url to rebuttal so builders can counter with their own evidence
alter table build_registry_disputes
  add column if not exists rebuttal_proof_url text;

notify pgrst, 'reload schema';
