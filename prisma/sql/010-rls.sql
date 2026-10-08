-- Isolamento entre empresas (tenants) feito pelo Postgres.
--
-- O `prisma db push` cria tabelas e colunas, mas nao conhece papel, politica
-- de seguranca por linha nem gatilho. Este arquivo cuida disso e pode rodar
-- quantas vezes for preciso (`npm run db:rls`); rode sempre depois do db push.
--
-- Como funciona
--
-- 1. A aplicacao conecta com o dono das tabelas (DATABASE_URL). O dono nao
--    passa pelas politicas: e o caminho "de sistema" (login, rastreio publico,
--    cadastro de empresa), usado so em src/lib/prisma.ts (`sistema`).
-- 2. Toda consulta feita em nome de uma empresa roda numa transacao que troca
--    para o papel `tms_app` e grava a empresa em `app.tenant_id`:
--        SELECT set_config('role', 'tms_app', true),
--               set_config('app.tenant_id', '<id>', true);
--    `tms_app` nao e dono de nada, entao as politicas valem para ele: so ve e
--    so grava linha do proprio tenant. As duas configuracoes morrem no fim da
--    transacao e nao vazam para a proxima consulta da mesma conexao.
-- 3. A coluna `tenantId` tem como valor padrao `current_setting('app.tenant_id')`
--    (schema.prisma). O codigo nao preenche a empresa na mao, e INSERT fora de
--    uma transacao de empresa falha em vez de cair na empresa errada.
-- 4. Chave estrangeira nao passa por politica: sem mais nada, daria para apontar
--    uma coleta para o cliente de outra empresa sabendo o id. O gatilho
--    `tms_mesmo_tenant` recusa referencia entre empresas.
--
-- Papel `tms_app`: precisa existir e o dono das tabelas precisa ser membro
-- dele. Onde o usuario da conexao pode criar papel (desenvolvimento, CI) este
-- arquivo cria. Em producao o dono nao tem esse direito; um superusuario roda
-- uma vez:
--     CREATE ROLE tms_app NOLOGIN;
--     GRANT tms_app TO tms_avilaops_com;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tms_app') THEN
    CREATE ROLE tms_app NOLOGIN;
  END IF;
  IF NOT pg_has_role(current_user, 'tms_app', 'MEMBER') THEN
    EXECUTE format('GRANT tms_app TO %I', current_user);
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO tms_app;

CREATE OR REPLACE FUNCTION tms_mesmo_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  i int;
  valor text;
  existe boolean;
BEGIN
  -- Argumentos em pares: coluna da chave estrangeira, tabela referenciada.
  FOR i IN 0 .. (TG_NARGS / 2 - 1) LOOP
    EXECUTE format('SELECT ($1).%I::text', TG_ARGV[2 * i]) INTO valor USING NEW;
    IF valor IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND "tenantId" = $2)', TG_ARGV[2 * i + 1])
        INTO existe USING valor, NEW."tenantId";
      IF NOT existe THEN
        RAISE EXCEPTION 'tms: % em "%" aponta para registro de outra empresa', TG_ARGV[2 * i], TG_TABLE_NAME
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

DO $$
DECLARE
  tabela text;
  -- tabela => pares (coluna, tabela referenciada)
  referencias jsonb := '{
    "User": ["clientId", "Client"],
    "Client": ["freightTableId", "FreightTable"],
    "FreightTableCity": ["tableId", "FreightTable"],
    "Driver": ["userId", "User"],
    "Vehicle": ["driverId", "Driver"],
    "Collection": ["clientId", "Client", "driverId", "Driver", "manifestId", "Manifest", "freightTableId", "FreightTable"],
    "CollectionStatusHistory": ["collectionId", "Collection", "userId", "User"],
    "Manifest": ["driverId", "Driver", "vehicleId", "Vehicle"],
    "FinancialTransaction": ["clientId", "Client"],
    "Maintenance": ["vehicleId", "Vehicle"],
    "ProofOfDelivery": ["collectionId", "Collection", "reviewedById", "User"],
    "SocialPost": ["articleId", "Article"],
    "ContentMetric": ["articleId", "Article"]
  }';
  argumentos text;
BEGIN
  FOR tabela IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('DROP POLICY IF EXISTS tms_tenant ON %I', tabela);
    EXECUTE format(
      'CREATE POLICY tms_tenant ON %I TO tms_app
         USING ("tenantId" = current_setting(''app.tenant_id'', true))
         WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      tabela
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO tms_app', tabela);

    EXECUTE format('DROP TRIGGER IF EXISTS tms_mesmo_tenant ON %I', tabela);
    IF referencias ? tabela THEN
      SELECT string_agg(quote_literal(valor), ', ') INTO argumentos
        FROM jsonb_array_elements_text(referencias -> tabela) AS valor;
      EXECUTE format(
        'CREATE TRIGGER tms_mesmo_tenant BEFORE INSERT OR UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION tms_mesmo_tenant(%s)',
        tabela, argumentos
      );
    END IF;
  END LOOP;
END
$$;

-- A empresa le o proprio cadastro e nada mais. Criar, alterar e desativar
-- empresa e trabalho do caminho de sistema.
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tms_tenant ON "Tenant";
CREATE POLICY tms_tenant ON "Tenant" FOR SELECT TO tms_app
  USING (id = current_setting('app.tenant_id', true));
REVOKE ALL ON "Tenant" FROM tms_app;
GRANT SELECT ON "Tenant" TO tms_app;
