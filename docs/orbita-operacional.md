# Alinhamento operacional com Órbita / ORBE

O MCP de leitura continua sendo a fronteira da integração. crm_resumo acrescenta horário da consulta e pagamentos/pagantes identificados do mês, usando o ledger BRL de saldo líquido positivo e excluindo datas futuras. Contato Cliente e conta ativa não comprovam pagamento. Pagantes do mês não são assinatura vigente; pagamentos sem contato são contados separadamente.

crm_funil_emails acrescenta horário de consulta, última mensagem na janela, registros agendados na janela, aceitos/adiados sem entrega confirmada e entregues sem resposta registrada. Não há envio automático. Zero respostas não prova que a captura de inbound esteja configurada; conferir o registro da caixa e os eventos antes de concluir ausência de interesse.

crm_tarefas permite filtrar produto com o vínculo explícito do contato. A Órbita consulta tarefas comerciais e aponta a edição para o CRM, sem criar cópias.

Painel de e-mails: filtros por origens com resposta e origens com falhas/descadastros. Falhas e descadastros têm colunas distintas. A tabela usa Registros para não chamar agendamentos do ledger de enviados; o funil MCP continua excluindo scheduled e datas futuras.

Sem alterações de schema, RLS, credenciais, campanhas ativas, envio ou contato com clientes nesta rodada.
