-- Remove o módulo LEGADO de qualificação (protótipo inicial). O módulo atual usa só
-- as tabelas eval_*. Nenhuma tela chamava as rotas /api/qualification-scripts e
-- /api/qualifications/* (removidas do server.ts no mesmo commit), e o initData()
-- re-semeava qualification_cycles/items a cada boot quando vazias.

-- Trava de segurança: só o seed (ciclos/itens) e a linha de demo em qualifications
-- são descartáveis. Se houver submissão ou roteiro legado gravado por alguém, a
-- migration falha em vez de apagar dado — investigar antes de promover.
DO $$
BEGIN
  IF to_regclass('public.qualification_submissions') IS NOT NULL
     AND EXISTS (SELECT 1 FROM qualification_submissions) THEN
    RAISE EXCEPTION '0051: qualification_submissions tem dados — não vou dropar';
  END IF;
  IF to_regclass('public.qualification_scripts') IS NOT NULL
     AND EXISTS (SELECT 1 FROM qualification_scripts) THEN
    RAISE EXCEPTION '0051: qualification_scripts tem dados — não vou dropar';
  END IF;
END $$;

-- Ordem respeita as FKs: itens de submissão → submissões → itens → ciclos.
DROP TABLE IF EXISTS qualification_submission_items;
DROP TABLE IF EXISTS qualification_submissions;
DROP TABLE IF EXISTS qualification_items;
DROP TABLE IF EXISTS qualification_cycles;
DROP TABLE IF EXISTS qualification_scripts;
DROP TABLE IF EXISTS qualifications;
