-- ADR-025 (F12 step 3): "Still accurate" — a confirmation re-asserts an
-- element's current values under a source of this new kind, so the
-- staleness that reads each fact's own date resets, and provenance says
-- the value was confirmed rather than newly entered. Its own migration:
-- Postgres can't use an enum value in the transaction that adds it
-- (20261004020000 widens sources_insert to allow it).

alter type source_kind add value if not exists 'attestation';
