-- Nova classe de acesso "PF não médico": pessoa física cujo grupo de prestador
-- NÃO é MEDICOS COOPERADOS (ex.: psicólogos, nutricionistas, médicos credenciados).
-- Regra espelhada em db/provider-role.ts (deriveProviderRole).

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('prestador','cooperado','pf_nao_medico','admin','auditoria'));

-- Backfill: reclassifica os acessos existentes a partir do prestador vinculado.
UPDATE users u
   SET role = CASE
       WHEN p.person_type = 'PF' AND btrim(p.provider_group) ~* '^MEDICOS COOPERADOS( ARARANGUA)?$' THEN 'cooperado'
       WHEN p.person_type = 'PF' THEN 'pf_nao_medico'
       ELSE 'prestador'
     END
  FROM providers p
 WHERE p.id = u.provider_id
   AND u.role IN ('prestador','cooperado','pf_nao_medico');
