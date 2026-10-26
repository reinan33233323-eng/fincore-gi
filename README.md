# FinCore Gi

Cópia independente do FinCore Pessoal no commit a943d6797b8b1b4d3fe6e264da02b9e27885e90a, com identidade rosa e as mesmas funcionalidades.

Repositório: https://github.com/reinan33233323-eng/fincore-gi

Banco exclusivo: fincore_gi, no perfil Supabase r3eizz-art. Projeto `ckzivafgsebigxlkqpgn`, com estrutura instalada. Nenhuma credencial ou dado do banco original foi copiado.

## Instalação

1. Criar o projeto Supabase fincore_gi.
2. Executar supabase/instalacao-limpa.sql no projeto vazio (inclui todas as migrações atuais).
3. Criar gi@master.com em Authentication e executar supabase/ativar-master.sql.
4. Desativar novos cadastros.
5. Preencher .env.local com URL e chave pública do novo projeto; a URL exclusiva já está fixada em src/main.tsx.
6. Executar npm ci, node --test tests/*.test.mjs e npm run build.

Sessões e preferências locais usam o prefixo fincore-gi. Os bancos Pessoal, Perino e Lauro não são usados pela cópia.
