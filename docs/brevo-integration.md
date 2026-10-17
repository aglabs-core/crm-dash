# Brevo: resultados dos envios API/SMTP

## Estado desta entrega

Implementação local, ainda sem publicação, migration remota ou webhook ativo. Na inspeção da conta autenticada em 17/10/2026, a tela de webhooks de saída estava vazia. Nenhuma configuração da Brevo foi salva e nenhum e-mail foi enviado.

O CRM organiza audiência, mensagem, revisão e acompanhamento. A Brevo entrega as mensagens. O receptor desta entrega somente recebe resultados; a fila de envio pelo CRM continua pendente.

## Como funciona

- `POST /api/integrations/brevo/webhook` exige Bearer próprio, recebe JSON limitado a 128 KiB/100 eventos e confirma apenas após a transação persistir. Sem configuração responde 503; sem autenticação válida responde 401.
- A conexão é fixada no servidor, nunca aceita do payload externo. O vínculo usa conta, identificador da mensagem e endereço normalizado; endereço isolado nunca basta. Contatos e etapas do funil não são alterados.
- Eventos anteriores ao vínculo ficam pendentes. Em cada destinatário da campanha, **Vincular envio externo** registra o identificador já emitido pela Brevo e concilia esses eventos, sem reenviar. A rota valida a sessão no servidor e o dono no banco.
- Repetições são deduplicadas pela impressão digital do evento. O campo `id` da Brevo identifica o webhook, não o evento individual. Datas usam timestamps UTC, sem interpretar a data localizada do provedor.
- O inbox retém somente tipo, data, identificador da mensagem e hash do endereço com escopo da conexão. Não guarda corpo, assunto, IP, link clicado, credenciais ou payload bruto. Os hashes ainda são dados derivados de pessoas: devem permanecer sob RLS.
- Descadastro, reclamação, endereço inválido e hard bounce impedem novas inclusões na audiência do mesmo dono, inclusive sem campanha associada. Isso não cancela envios feitos fora do CRM e não importa retroativamente a lista de bloqueios da Brevo.
- Aberturas por proxy ficam separadas. Um evento tardio de abertura não esconde descadastro/reclamação/falha permanente. Tipos desconhecidos ficam registrados como ignorados; webhook de e-mail não comprova resposta humana.

## Ativação após publicação

1. Aplicar, em ordem, as migrations de observabilidade, preparação guiada e `20261017160727_brevo_event_receiver.sql` ao projeto correto. Executar primeiro o dry-run e conferir as migrations pendentes.
2. Na tela **Integrações**, preparar o cadastro da conexão com a conta proprietária das campanhas. Copiar o UUID dessa conexão.
3. Configurar somente no servidor `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_WEBHOOK_CONNECTION_ID` e `BREVO_WEBHOOK_TOKEN` aleatório com ao menos 32 caracteres. Usar o UUID do passo anterior. Nunca usar prefixo `NEXT_PUBLIC_` para esses três valores; não registrar segredos em Git, capturas ou logs.
4. Publicar o endpoint HTTPS no domínio real do CRM. Ele é acessível à Brevo, autenticado pelo segredo próprio, e precisa permanecer fora de redirecionamentos de login ou proteções de preview. Verificar que requisição sem segredo é recusada.
5. Na Brevo, criar webhook **de saída/transacional** apontando para `/api/integrations/brevo/webhook` no domínio publicado. Configurar a autenticação Bearer com o mesmo segredo do servidor. Selecionar envios, entregas, falhas, aberturas, cliques, descadastros e reclamações disponíveis. Salvar somente com autorização vigente para essa alteração da conta.
6. Usar evento sintético para verificar autenticação, persistência e replay. Depois, mediante autorização para envio de teste, validar um único e-mail interno: obter o ID, vincular ao destinatário de teste e conferir o evento recebido. Não usar leads reais para testar.
7. Conferir a tela Integrações e a campanha. **Eventos recebidos** comprova recebimento anterior; não é monitoramento contínuo da conexão. Histórico anterior à ativação não é recuperado automaticamente: será necessária conciliação específica por ID/API.

Esta versão aceita uma conexão Brevo por dono e um vínculo de mensagem por participação na campanha. Reenvios/sequências com múltiplas mensagens exigem um ledger de tentativas antes de implementar a fila. Não sobrescrever o vínculo anterior. Um vínculo existente bloqueia a edição do conteúdo e a remoção desse destinatário, mesmo antes da chegada do primeiro evento; a regra é validada no banco, além da interface. O agente deverá registrar os IDs nessa mesma estrutura ao enviar, com o mesmo fluxo de revisão, supressão e idempotência do futuro envio pelo front.

## Validação

Testes locais com PostgreSQL embarcado PGlite e dados sintéticos cobrem reexecução da migration, RLS, isolamento entre contas, eventos pendentes, vínculo, replay e supressão. Testes HTTP cobrem autenticação, limites, lote inválido e falha de persistência. Testes de interface cobrem preparação do cadastro e vínculo externo. Isso não comprova configuração do ambiente remoto nem recebimento real da Brevo.

Referências oficiais: [payloads transacionais](https://developers.brevo.com/docs/transactional-webhooks), [autenticação do webhook](https://developers.brevo.com/docs/secured-webhooks) e [configuração de saída](https://help.brevo.com/hc/en-us/articles/27824932835474-Create-outbound-webhooks-to-send-real-time-data-from-Brevo-to-an-external-app).
