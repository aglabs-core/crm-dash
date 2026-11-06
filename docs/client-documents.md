# Documentos privados do CRM

## Escopo

Seção Documentos na ficha do contato; central `/documents` com os mesmos registros, sem duplicar arquivos. Contratos, propostas, XML/PDF de notas, comprovantes e outros documentos. Vínculo opcional com pagamento do mesmo proprietário e contato. Competência informada manualmente, sem inferir pela data do upload ou pagamento.

O modelo de serviços/contratações ainda será um incremento separado: não há segundo estágio comercial nem referência de serviço fictícia. Não há emissão NFS-e, validação tributária, parse fiscal do XML, integração com gateway emissor ou status automático de “nota autorizada”.

## Armazenamento e segurança

- Bucket separado `crm-documents`, **privado**, com limite de 10 MiB por objeto, formatos PDF/XML/PNG/JPEG e MIME controlado. Nunca usar o bucket público de avatares.
- Metadados em `client_documents`, RLS e grants SELECT/INSERT explícitos. Proprietário da ficha controla os arquivos; acesso administrativo preexistente a contatos não concede acesso automático aos documentos.
- FKs compostas impedem vincular dados entre proprietários; trigger confere existência, tamanho/MIME do original no Storage e pagamento do mesmo contato. Timestamp do cadastro é definido no banco.
- Arquivos com paths `proprietario/contato/uuid.ext`, sem nome/CPF/CNPJ no caminho. Downloads autenticados como anexos; sem renderização de XML/PDF no domínio do CRM ou URL pública.
- Hash SHA-256 calculado pelo cliente para deduplicação por contato; não constitui assinatura digital, prova de autenticidade ou verificação de conteúdo pelo servidor. Validação inicial de assinatura de arquivo e extensão na interface; Storage impõe tamanho/MIME. Não há antivírus ou análise de arquivos no servidor nesta etapa.
- Originais e metadados sem UPDATE/DELETE para usuários autenticados. Contatos/usuários com evidências vinculadas não podem ser apagados em cascata; revisão de retenção/eliminação deve ocorrer por procedimento privilegiado, não por exclusão casual da ficha. Arquivamento comercial permanece independente.
- Nenhum acesso novo pelo MCP, exportação de cadastros ou registro de conteúdo em log.

## Upload não é uma transação SQL com Storage

Upload e cadastro são duas operações. A UI mantém o UUID/arquivo em memória enquanto o envio não estiver confirmado e permite repetir no mesmo path, com `upsert: false`. Um conflito 409 permite tentar novamente o cadastro; a trigger exige o objeto correspondente. Timeout de INSERT é reconciliado por hash no retry. Não apagar originais após resultado incerto.

Limitações: fechar a página durante falha entre Storage e banco pode deixar objeto privado sem metadados; uploads concorrentes do mesmo arquivo podem deixar uma cópia privada não indexada, ainda que a constraint impeça duplicar o cadastro. Antes de ampliar o volume, implementar reconciliação server-side de objetos órfãos com período de segurança, sem exclusão automática de evidências. Não há rotina de limpeza automática nesta entrega.

## Backup e crescimento

Backup do Postgres não substitui backup do conteúdo do Storage. Definir cópia privada dos objetos, política de retenção com o contador, controle de capacidade e teste de restauração antes de usar o CRM como único arquivo da empresa. Não foi criada cópia externa de documentos reais, contratado armazenamento ou configurada automação de backup.

## Ordem de ativação

1. Revisar/aplicar `20261106160752_private_client_documents.sql` antes do frontend.
2. Confirmar que não existem policies genéricas preexistentes em `storage.objects` que abram o bucket (policies permissivas se somam). A migration antiga dos avatares é limitada a `crm-dash` e não é reaproveitada.
3. Validar upload/download autenticado entre dois proprietários, isolamento de administradores e falhas de rede, com arquivos sintéticos, no Storage real.
4. Publicar UI; depois confirmar um documento real manualmente, com sua retenção/backup definidos.

Migration criada via CLI e testada em PostgreSQL PGlite com schemas de Storage/Auth sintéticos. Isso não simula serviço HTTP de arquivos, detecção MIME do provedor, políticas adicionais reais, nem comprova aplicação em produção. O conector de produção havia recusado acesso; não foi contornado e nenhuma migration remota foi aplicada nesta etapa.

## Aplicativos e gateways: regra operacional

Para Barberias, Viajeki, Members, MeCard e AG LABS App, identificar **quem vende, o que vende e quem consta como prestador no documento**. Marca do aplicativo não significa empresa emissora diferente.

- Se a AG LABS vende assinatura/licença/acesso, a operação exige seu tratamento fiscal; cadastro gratuito, isoladamente, não é venda. Código/competência/tributação devem ser validados pelo contador.
- Se o gateway/integrador já emite NFS-e autorizada em nome da AG LABS para o comprador referente à mesma operação, importar/vincular a nota existente, sem emitir outra.
- Recibo de cartão/Pix, boleto, invoice comercial ou relatório de repasse não demonstram por si só emissão de NFS-e. Documentos das taxas do intermediário referem-se a outra relação de serviço.
- Members e outros fluxos de marketplace: separar assinatura/comissão da AG LABS das vendas de produtores/terceiros. Não emitir indiscriminadamente pelo valor total de terceiros; depende de contratos, titularidade da venda e responsabilidades.
- Barberias: assinatura do sistema e serviços da barbearia são operações distintas. Viajeki: acesso ao planejador e serviços turísticos vendidos por terceiros também exigem separação.
- Créditos pré-pagos do AG LABS App exigem definição contábil do momento fiscal; não emitir automaticamente uma nota por geração nem uma nova nota ao consumir créditos sem validar o modelo.

Não foi verificado se qualquer aplicativo já tem emissão fiscal ativa no gateway. Antes de automatizar, conferir documento autorizado, prestador/CNPJ, tomador, descrição, competência, valor e código de verificação; depois reconciliar a cobrança com o identificador fiscal existente.

Fontes consultadas em 06/11/2026:
- [Asaas: emissão automática de NFS-e por assinatura exige configuração](https://central.ajuda.asaas.com/hc/pt-br/articles/54589317488283-Como-configurar-a-emiss%C3%A3o-autom%C3%A1tica-de-NFS-e-em-uma-assinatura).
- [Receita: SC Cosit 222/2019 sobre licenciamento e assinatura de acesso a software](https://normas.receita.fazenda.gov.br/sijut2consulta/anexoOutros.action?idArquivoBinario=52958).
- [Supabase: acesso a buckets privados](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Validação desta entrega

- `npm run check` aprovado em cópia limpa, com dependências do lockfile (Next 15.5.28), somente `.env.example`, sem `.env.local` e sem as variáveis públicas do Supabase: lint, TypeScript, 195 testes de lógica/banco, 60 testes de interface e build.
- Migration executada duas vezes no teste PGlite; isolamento de proprietários, bloqueio de acesso anônimo, FK/trigger de pagamento, existência/tamanho do original e imutabilidade verificados com dados sintéticos.
- Testes de transporte e UI verificam paginação, validação de formato/tamanho, retry sem overwrite/delete, indisponibilidade explícita e ausência de permissão administrativa implícita.
- `npm run audit:gate`: zero alertas e zero exceções; `git diff --check` sem erro.
- Não houve teste visual autenticado, aplicação remota de schema, teste HTTP contra Storage real, configuração de backup dos anexos, CI remoto, merge ou publicação.
