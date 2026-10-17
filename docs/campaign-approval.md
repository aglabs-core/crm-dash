# Preparação aprovada de campanhas

**Banco:** a migration `20261017173524_campaign_approval_queue.sql` foi aplicada em 17/10/2026 após testes e dry-run. A interface segue a publicação pelo CI de `main`. O receptor Brevo é uma entrega anterior, já publicada e validada com solicitações sintéticas da própria Brevo que retornaram HTTP 200.

O CRM congela uma versão revisada do público e da mensagem. Esta entrega não dispara mensagens, não agenda envios e não marca campanhas como enviadas. O envio automático exige um executor próprio e a configuração de envio Brevo; o webhook já ativo continua recebendo os resultados dos envios externos.

## Fluxo no front

1. Criar a campanha e usar **Salvar preparação** com os destinatários revisados.
2. Na seção **Preparação aprovada**, abrir **Revisar versão para aprovação**. O banco monta assunto e texto personalizados para cada destinatário e mostra mudanças de cadastro, bloqueios, supressões e duplicidade de endereço. Para substituir uma revisão anterior à aprovação, usar **Revisar novamente**.
3. Conferir remetente, resposta, público e texto final; preencher **Nota da aprovação** e confirmar a revisão. **Congelar aprovação sem enviar** salva a versão em uma transação. A seção permanece identificada como **Sem disparo automático**. O conteúdo não é autorização permanente para envio e não comprova que o remetente está validado no provedor.
4. Com aprovação ativa ou pausada, a preparação fica bloqueada para edição. Para corrigir o rascunho, cancelar a aprovação e fazer outra revisão. A versão anterior permanece no histórico e nunca é reescrita.
5. **Pausar aprovação** e **Retomar aprovação** controlam a disponibilidade da preparação aprovada. **Cancelar aprovação** não recolhe mensagens já aceitas pelo provedor. O estado ativo aparece como **Aprovada para execução externa**; os demais são **Pausada** e **Cancelada**. Um envio externo já realizado pode continuar sendo registrado em **Vincular envio externo** para conciliar seu histórico, inclusive após descadastro.
6. Usar **Atualizar situação** para consultar os impedimentos atuais e os vínculos externos. A tela não oferece monitoramento contínuo; falha na leitura bloqueia a preparação para edição até que a situação seja conferida.

Cada versão tem uma chave de aprovação, dono/aprovador, horário, nota, remetente, resposta e snapshots literais de nome, endereço, assunto e texto final. O limite é de 200 destinatários por versão. A revisão gera uma impressão digital do conteúdo e da audiência: qualquer mudança antes da aprovação exige nova revisão. Repetir a mesma aprovação após uma resposta de rede perdida recupera a mesma versão, sem duplicar.

O texto usa `{{nome}}` e `{{produto}}`; o produto é substituído pela chave salva na campanha, igual à prévia de preparação. Os snapshots são texto, nunca HTML executável. O histórico contém dados pessoais sob RLS e não deve ser exportado para logs, issues ou documentação pública.

## Contrato para integração do agente

As RPCs usam a sessão autenticada do proprietário da campanha. Não compartilhar a chave `service_role` com agentes nem chamar a fila com um dono arbitrário.

| Operação | RPC |
|---|---|
| Revisar o rascunho atual | `review_email_campaign_batch(p_campaign_id)` |
| Aprovar a revisão exata | `approve_email_campaign_batch(p_campaign_id, p_fingerprint, p_approval_key, p_note)` |
| Consultar versões e bloqueios atuais | `campaign_batch_overview(p_campaign_id)` |
| Pausar, retomar ou cancelar | `set_email_campaign_batch_state(p_batch_id, p_state)` |

O agente deverá trabalhar com os textos congelados dessa mesma versão, respeitar estado `approved` e os motivos atuais por destinatário, e registrar o identificador da mensagem já enviada no receptor autenticado existente. A consulta serve para organização e conferência: não reserva itens, não fornece exclusão mútua para múltiplos executores e não autoriza disparo automático. Enquanto não houver o executor comum com claim/tentativas, não executar agentes e operadores concorrentes para enviar o mesmo lote.

O futuro executor deve revalidar as permissões e supressões imediatamente antes do envio, reconciliar os bloqueios históricos da Brevo, reservar cada tentativa de forma durável e tratar timeout/aceitação sem ID como resultado incerto. A idempotência temporária do provedor não substitui esse controle. Reenvios e sequências exigem um ledger de mensagens/tentativas, pois a participação atual tem apenas um ID de envio externo.

## Segurança e validação

As tabelas permitem somente leitura por dono. As duas mutações privilegiadas ficam em schema privado, fora da API de schemas expostos, com `search_path` vazio e verificação explícita de `auth.uid()` e propriedade; wrappers públicos usam SECURITY INVOKER. A aprovação bloqueia a campanha, os destinatários e os contatos durante a transação. Triggers preservam o rascunho aprovado mesmo em alterações diretas pela API. As versões canceladas não podem ser reativadas.

Fixtures sintéticas em PostgreSQL/PGlite validam RLS, reexecução da migration, mudança de personalização, replay, bloqueio de escrita direta, cancelamento, histórico, supressões e endereços duplicados. Testes de interface verificam revisão, confirmação, falhas e transições sem chamadas a serviços de envio.

Após a aplicação em 17/10/2026, o dry-run confirmou o banco atualizado. Chamadas anônimas às RPCs de revisão e consulta foram recusadas com HTTP 401. Essas verificações não substituem a conferência autenticada da interface nem comprovam envio de e-mail real.
