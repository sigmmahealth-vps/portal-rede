-- Função dos acessos PF passa a ter três classes (cliente, 2026-09-25):
--   MEDICOS COOPERADOS → cooperado · MEDICOS CREDENCIADOS → credenciado · demais PF → pf_nao_medico.
-- Até aqui "credenciado" cobria todo PF não cooperado (0052). Regra espelhada em db/provider-role.ts.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('prestador','cooperado','credenciado','pf_nao_medico','admin','auditoria'));

-- Backfill: reclassifica os acessos existentes a partir do prestador vinculado.
UPDATE users u
   SET role = CASE
       WHEN p.person_type = 'PF' AND btrim(p.provider_group) ~* '^MEDICOS COOPERADOS(\s+ARARANGUA)?$'   THEN 'cooperado'
       WHEN p.person_type = 'PF' AND btrim(p.provider_group) ~* '^MEDICOS CREDENCIADOS(\s+ARARANGUA)?$' THEN 'credenciado'
       WHEN p.person_type = 'PF' THEN 'pf_nao_medico'
       ELSE 'prestador'
     END
  FROM providers p
 WHERE p.id = u.provider_id
   AND u.role IN ('prestador','cooperado','credenciado','pf_nao_medico');
