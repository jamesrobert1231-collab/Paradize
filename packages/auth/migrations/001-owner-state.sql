-- Apply once, explicitly, as the migration owner in the dedicated identity database.
-- This creates an uninitialized anchor; it does not create an owner or grant authority.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';

DO $$
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'PARADIZE identity requires PostgreSQL 17';
  END IF;
END
$$;

-- No IF NOT EXISTS: an existing schema must be reviewed, never silently initialized.
CREATE SCHEMA paradize_identity;
REVOKE ALL ON SCHEMA paradize_identity FROM PUBLIC;

CREATE TABLE paradize_identity.owner_state (
  singleton smallint PRIMARY KEY CHECK (singleton = 1),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  revision bigint NOT NULL CHECK (revision >= 0),
  last_observed_at bigint NOT NULL CHECK (last_observed_at BETWEEN 0 AND 9007199254740991),
  state jsonb,
  CONSTRAINT owner_state_envelope CHECK (
    (state IS NULL AND revision = 0) OR
    (state IS NOT NULL AND revision > 0 AND jsonb_typeof(state) = 'object'
      AND octet_length(state::text) <= 1048576)
  )
);
REVOKE ALL ON TABLE paradize_identity.owner_state FROM PUBLIC;
INSERT INTO paradize_identity.owner_state (singleton, schema_version, revision, last_observed_at, state)
VALUES (1, 1, 0, 0, NULL);
COMMIT;
