# Campanhas de e-mail no CRM

## Recursos publicados

- Rascunhos por produto/provedor/remetente/assunto e base da audiência.
- Preparação guiada de contatos do mesmo produto, com nota obrigatória de permissão ou revisão e até 200 novas inclusões por preparação. Contatos bloqueados, sem revisão, com endereço inválido ou com supressão conhecida não entram.
- Métricas por destinatário único e histórico de entregas, aberturas, cliques, respostas registradas, falhas, adiamentos, bloqueios, reclamações, descadastros e aberturas por proxy.
- Receptor Brevo autenticado, conciliação pelo identificador da mensagem e supressões por endereço. O webhook está ativo e os testes sintéticos da própria Brevo retornaram HTTP 200; nenhum e-mail real foi disparado nessa validação.
- RLS por dono da campanha. O navegador pode ler eventos, mas não gravá-los. Eventos externos só entram por `service_role`.
- **Nenhum envio é disparado pelo CRM nesta etapa.** Um rascunho não deve ser interpretado como campanha enviada nem como lead novo no funil.

## Operação

1. Criar rascunho e escolher o provedor. `resend` exige `opt_in`; abordagem individual revisada não equivale a opt-in.
2. Conferir remetente verificado **no provedor escolhido**. A existência do domínio em outro provedor não comprova autenticação neste.
3. Registrar evidência por destinatário. Antes de qualquer envio futuro, revalidar opt-out, bounce, duplicidade e permissão atual; a nota histórica não dispensa essa checagem.
4. Para mensagens já enviadas por API/SMTP, usar **Vincular envio externo** no destinatário e informar o identificador da Brevo. O conector associa conta, mensagem e endereço; eventos anteriores ao vínculo são conciliados sem reenviar. Repetições não duplicam eventos. Não gravar payload bruto nem credencial na UI ou em logs.
5. Respostas vêm do atendimento (Maia), não necessariamente do webhook do provedor. Registrar `replied` somente quando uma resposta real estiver associada ao contato/campanha.
6. Só marcar campanha `active` após aceitação do provedor; `completed` após conciliar os resultados. Essas transições são de serviço, não do navegador.

## Estado das integrações

O receptor Brevo está publicado e ativo; consulte [ativação, evidências e limites](brevo-integration.md). A tela **Integrações** apresenta **Eventos recebidos** quando houve persistência anterior. Isso não comprova monitoramento contínuo, entrega de e-mail real ou conciliação de uma campanha específica. Eventos sem correspondência permanecem aguardando vínculo. Para Resend, a recepção com assinatura Svix e o registro dos e-mails do sistema estão descritos em [registro único de e-mails](email-ledger.md).

Envios anteriores, incluindo o piloto Barberias registrado em `activities`, exigem conciliação específica pelos identificadores das mensagens. O webhook não recupera automaticamente esse histórico. Não reenviar mensagens nem transformar contatos desse piloto em novo lote para tentar preencher métricas.

## Preparação guiada publicada

Decisão: o CRM concentra público, conteúdo, revisão e acompanhamento; Brevo continua a infraestrutura de entrega. Alternativas: operar tudo na Brevo é rápido, mas fragmenta contexto; criar um motor de entrega próprio aumenta custo operacional; CRM + provedor aproveita o cadastro e mantém a empresa numa interface. Referências: [fluxo Brevo](https://help.brevo.com/hc/pt/articles/4413566705298-Crie-e-envie-uma-campanha-de-e-mail) e [editor HubSpot](https://knowledge.hubspot.com/marketing-email/create-and-send-marketing-emails).

O atalho **Campanha Barberias** abre um rascunho e encaminha à preparação em três etapas: **Público**, **Mensagem** e **Revisão**. O público permite grupos **Prospecção**, **Funil ativo**, **Clientes** e **Todos do produto**, além de origem, busca, exclusões explicadas e seleção explícita de até 200 novos destinatários. Trocar filtros limpa a seleção. A chave `barberpro` é reconhecida como alias de `barberias` apenas para comparação; os valores persistidos das integrações não são reescritos.

**Salvar preparação** guarda assunto, texto, endereço de resposta e novos destinatários no rascunho. A prévia suporta `{{nome}}` e `{{produto}}` e apresenta todo conteúdo como texto: HTML não é executado. A aprovação descrita abaixo congela esses textos já personalizados por destinatário; um futuro executor deverá usar exatamente a versão aprovada. Remetente verificado, opt-out e entrega real ainda dependem da integração de envio.

A migration `20261017034819_guided_campaign_preparation.sql` acrescenta conteúdo e resposta, além da RPC `prepare_email_campaign` com SECURITY INVOKER. Ela revalida dono, estado do rascunho, produto, endereço, revisão, limite e bloqueios; mantém campanha/conteúdo/audiência numa transação. Registros existentes permanecem; repetir inclusão não duplica a participação. Contato, origem e etapa do funil não são alterados. Mudança de produto, bloqueio, descadastro ou reclamação podem fazer uma seleção antiga ser rejeitada no banco. A política de inserção direta também exige revisão/produto/endereço compatíveis e impede recadastrar endereços com supressão já registrada em campanhas do mesmo dono. Isso cobre o histórico conhecido no CRM; não substitui conciliar as listas de bloqueio da Brevo.

A evidência por lote deve corresponder a todos os selecionados; grupos com contextos diferentes devem ser preparados separadamente. `contactable` não comprova opt-in. Conteúdo e audiência ainda são rascunho, nunca autorização para disparo. Após existir histórico do provedor, esta RPC não altera a campanha.

Validação da preparação: PostgreSQL embarcado PGlite (somente desenvolvimento) com fixtures sintéticas para reexecução da migration, isolamento entre contas, replay, validação atômica e RLS em inserção direta; testes de interface para seleção, exclusões, prévia, confirmação e falha. As migrations de preparação e recepção Brevo já foram aplicadas ao banco remoto; isso é separado da nova migration de aprovação.

## Preparação aprovada

A etapa **Preparação aprovada** usa a migration `20261017173524_campaign_approval_queue.sql`, aplicada em 17/10/2026, e a interface segue a publicação pelo CI de `main`. Ela apresenta **Sem disparo automático**: **Revisar versão para aprovação** monta o público e os textos finais; **Congelar aprovação sem enviar** registra a versão imutável após nota e confirmação. **Atualizar situação** consulta os impedimentos atuais. **Pausar aprovação**, **Retomar aprovação** e **Cancelar aprovação** preservam o histórico e os vínculos externos. Rascunhos sem público ou texto orientam a concluir a preparação primeiro.

Essa fila organiza a revisão entre front e agente; não reserva tentativas nem executa envios. O executor comum, a configuração de envio Brevo, o opt-out efetivo, o teste interno por e-mail e o envio/agendamento real permanecem pendentes. O agente deverá consultar a mesma versão aprovada e registrar os identificadores externos, sem manter uma segunda audiência. Consulte o [contrato e os limites da preparação aprovada](campaign-approval.md).
