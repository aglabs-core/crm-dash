# Central de ações

`/actions` reúne sinais para revisão, com produto como primeiro filtro e links para as fichas existentes. Não cria outro funil, não envia mensagens e não altera etapas.

- Tarefas vencidas: pendentes com data anterior ao dia local do usuário.
- Respostas: última mensagem por contato e produto é recebida, considerando apenas e-mails fora de automação/transacional. Envios agendados, falhos e futuros não escondem respostas. Não indica leitura humana nem substitui revisão de WhatsApp e outros canais.
- Testes encerrados: `account_status=trial_encerrado`, confirmado pela integração; exclui clientes, arquivados, inativos e base fria. Não calcula vencimento a partir do cadastro nem presume pagamento pendente.
- Sem próximo passo: oportunidade ativa fora da base fria sem tarefa pendente vinculada. Uma tarefa sem prazo também conta como próximo passo.

Permissões: cliente Supabase da sessão, mantendo RLS. Consultas paralelas com cancelamento e paginação de 500; até 5.000 registros recentes por fonte, com aviso de cobertura parcial. Quando tarefas ultrapassam a janela, a ausência de próximo passo não é calculada. Falha de qualquer fonte oculta os números até nova consulta. Cada pessoa pode aparecer por mais de um motivo; não somar ações como contatos únicos.

O MCP `crm_prioridades` consulta completamente contatos e tarefas e devolve somente três contagens operacionais (sem respostas de e-mail). A ORBE valida produto e contrato, informa indisponibilidade sem inventar zeros e usa a ferramenta com metas, vault e receita para recomendar ações.

Métricas administrativas seguem Barberias → CRM → Órbita. Este recurso não ativa credenciais nem comprova coleta do aplicativo: `ORBITA_METRICS_TOKEN` na origem e `APP_METRICS_SOURCES` no CRM ainda devem estar configurados e validados antes de afirmar cobertura operacional.
