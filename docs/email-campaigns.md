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
