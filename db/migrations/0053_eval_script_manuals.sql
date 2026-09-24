-- Manual (PDF) por roteiro — chave = source_file (sobrevive a novas revisões).
-- Spec: docs/superpowers/specs/2026-09-24-manual-do-roteiro-design.md
CREATE TABLE IF NOT EXISTS eval_script_manuals (
  source_file  text PRIMARY KEY,
  filename     text        NOT NULL,
  size_bytes   integer     NOT NULL,
  content      bytea       NOT NULL,
  uploaded_by  bigint      REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
