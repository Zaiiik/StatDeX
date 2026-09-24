-- Compatibility marker for the production hot-fix applied while validating
-- the progression guard. Fresh databases already receive the corrected
-- jsonb_object_keys counting logic from the preceding canonical migration.
do $$ begin null; end $$;
