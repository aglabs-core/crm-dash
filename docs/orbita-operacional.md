# Alinhamento operacional com Órbita / ORBE

O MCP de leitura continua sendo a fronteira da integração. crm_resumo acrescenta horário da consulta e pagamentos/pagantes identificados do mês, usando o ledger BRL de saldo líquido positivo e excluindo datas futuras. Contato Cliente e conta ativa não comprovam pagamento. Pagantes do mês não são assinatura vigente; pagamentos sem contato são contados separadamente.

crm_funil_emails acrescenta horário de consulta, última mensagem na janela, registros agendados na janela, aceitos/adiados sem entrega confirmada e entregues sem resposta registrada. Não há envio automático. Zero respostas não prova que a captura de inbound esteja configurada; conferir o registro da caixa e os eventos antes de concluir ausência de interesse.

crm_tarefas permite filtrar produto com o vínculo explícito do contato. A Órbita consulta tarefas comerciais e aponta a edição para o CRM, sem criar cópias.

Painel de e-mails: filtros por origens com resposta e origens com falhas/descadastros. Falhas e descadastros têm colunas distintas. A tabela usa Registros para não chamar agendamentos do ledger de enviados; o funil MCP continua excluindo scheduled e datas futuras.

Sem alterações de schema, RLS, credenciais, campanhas ativas, envio ou contato com clientes nesta rodada.


## Coleta administrativa centralizada (24/10)
`crm_metricas_produto({produto:"barberias"})` requer escopo leitura, consulta o contrato v1 do aplicativo e retorna status, checkedAt, data e via:crm. Configure APP_METRICS_SOURCES somente no servidor: [{"product":"barberias","url":"https://barberias.com.br/api/integrations/orbita/metrics","token":"<segredo dedicado de pelo menos 32 caracteres>"}]. Sem segredo, retorna not_configured. Não usar token superadmin.

API somente leitura, origem fixa HTTPS, sem redirects, timeout 8s, resposta até32KiB. Snapshot antigo mantém generatedAt e status stale; indisponibilidade não vira zero. Campos desconhecidos são descartados, nunca chegam à Órbita. Contagens não alteram o funil nem substituem pagamentos do ledger. Eventos de conta continuam no receptor de contas existente, com identidade externa explícita.

Ativação exige configurar o mesmo segredo dedicado no produto e no CRM e comparar com o superadmin. Não declarar conexão ativa apenas por publicar o conector.
