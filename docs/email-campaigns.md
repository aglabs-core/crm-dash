# Campanhas de e-mail no CRM

## Escopo desta entrega

- Rascunhos por produto/provedor/remetente/assunto e base da audiência.
- Inclusão individual de contatos do mesmo produto, com nota obrigatória de permissão ou revisão. Contatos com `outreach_status=blocked` não entram.
- Métricas por destinatário único e histórico de eventos `sent`, `delivered`, `opened`, `clicked`, `replied`, `bounced`, `complained`, `unsubscribed`.
- RLS por dono da campanha. O navegador pode ler eventos, mas não gravá-los. Eventos externos só entram por `service_role`.
- **Nenhum envio é disparado pelo CRM nesta etapa.** Um rascunho não deve ser interpretado como campanha enviada nem como lead novo no funil.

## Operação

1. Criar rascunho e escolher o provedor. `resend` exige `opt_in`; abordagem individual revisada não equivale a opt-in.
2. Conferir remetente verificado **no provedor escolhido**. A existência do domínio em outro provedor não comprova autenticação neste.
3. Registrar evidência por destinatário. Antes de qualquer envio futuro, revalidar opt-out, bounce, duplicidade e permissão atual; a nota histórica não dispensa essa checagem.
4. O conector server-side deverá relacionar `provider_campaign_id` e `provider_message_id`, resolver o destinatário, inserir eventos com `provider_event_id` estável e processar replays via conflito único `(recipient_id, provider_event_id)`. Não gravar payload bruto nem credencial na UI ou em logs.
5. Respostas vêm do atendimento (Maia), não necessariamente do webhook do provedor. Registrar `replied` somente quando uma resposta real estiver associada ao contato/campanha.
6. Só marcar campanha `active` após aceitação do provedor; `completed` após conciliar os resultados. Essas transições são de serviço, não do navegador.

## Próxima integração necessária

Os painéis ficam sem eventos até o conector ser ligado. Para Resend, configurar webhook com verificação de assinatura e segredo próprio no servidor; para Brevo, importar eventos pelo identificador da mensagem ou webhook autenticado. O `RESEND_API_KEY` disponível no cofre do OpenClaw validou a conta/domínio, mas **não** é um segredo de assinatura do webhook nem foi copiado para o CRM.

O piloto Barberias de 09/10 (cinco mensagens Brevo) já consta em `activities`. Pode ser conciliado no novo ledger após a migration, sem reenviar: quatro entregues e um soft bounce. Não converter automaticamente esses cinco contatos em novo lote.

## Preparação guiada no CRM — evolução local de 17/10

Decisão: o CRM concentra público, conteúdo, revisão e acompanhamento; Brevo continua a infraestrutura de entrega. Alternativas: operar tudo na Brevo é rápido, mas fragmenta contexto; criar um motor de entrega próprio aumenta custo operacional; CRM + provedor aproveita o cadastro e mantém a empresa numa interface. Referências: [fluxo Brevo](https://help.brevo.com/hc/pt/articles/4413566705298-Crie-e-envie-uma-campanha-de-e-mail) e [editor HubSpot](https://knowledge.hubspot.com/marketing-email/create-and-send-marketing-emails).

O atalho Campanha Barberias abre um rascunho e encaminha à preparação em três etapas: Público, Mensagem e Revisão. O público permite grupos Prospecção/Funil/Clientes, origem, busca, exclusões explicadas e seleção explícita de até 200 novos destinatários. Trocar filtros limpa a seleção. A chave `barberpro` é reconhecida como alias de `barberias` apenas para comparação; os valores persistidos das integrações não são reescritos.

Assunto, texto e endereço de resposta ficam salvos no rascunho. A prévia suporta `{{nome}}` e `{{produto}}` e apresenta todo conteúdo como texto: HTML não é executado. Esses tokens são contrato de preparação; o futuro adaptador deverá substituí-los também na mensagem entregue. Remetente verificado, opt-out e layout final ainda dependem da integração de envio.

A migration `20261017034819_guided_campaign_preparation.sql` acrescenta conteúdo e resposta, além da RPC `prepare_email_campaign` com SECURITY INVOKER. Ela revalida dono, estado do rascunho, produto, endereço, revisão, limite e bloqueios; mantém campanha/conteúdo/audiência numa transação. Registros existentes permanecem; repetir inclusão não duplica a participação. Contato, origem e etapa do funil não são alterados. Mudança de produto, bloqueio, descadastro ou reclamação podem fazer uma seleção antiga ser rejeitada no banco. A política de inserção direta também exige revisão/produto/endereço compatíveis e impede recadastrar endereços com supressão já registrada em campanhas do mesmo dono. Isso cobre o histórico conhecido no CRM; não substitui conciliar as listas de bloqueio da Brevo.

A evidência por lote deve corresponder a todos os selecionados; grupos com contextos diferentes devem ser preparados separadamente. `contactable` não comprova opt-in. Conteúdo e audiência ainda são rascunho, nunca autorização para disparo. Após existir histórico do provedor, esta RPC não altera a campanha.

Validação: PostgreSQL embarcado PGlite (somente desenvolvimento) com fixtures sintéticas para reexecução da migration, isolamento entre contas, replay, validação atômica e RLS em inserção direta; testes de interface para seleção, exclusões, prévia, confirmação e falha. Nenhuma migration foi aplicada ao banco remoto.

Próxima entrega: conectar a conta Brevo do ecossistema, registrar identificadores de mensagens dos envios API/SMTP existentes, receber/conferir eventos, estruturar supressões por endereço e implementar fila de envio aprovada. Só depois haverá teste interno por email, envio/agendamento real e parada ao receber resposta/descadastro. O agente pode colaborar nessa mesma fila; não deve manter uma segunda audiência ou disparar campanhas por fora sem registro.
