# Aquisição e ativação dos aplicativos

Este roteiro orienta a revisão dos resultados. Não ativa campanhas, envios ou cadências e não altera ofertas.

## Revisão semanal

1. Em Ecossistema, conferir a data e a disponibilidade da origem de cada produto. Dado ausente ou antigo não é zero.
2. Revisar os grupos de ativação destacados. No Barberias, as diferenças entre etapas são grupos exclusivos da mesma unidade (conta), não taxas de conversão de campanha.
3. Em Ações comerciais, conferir histórico e tarefas antes de escolher uma próxima ação. Teste encerrado não prova interesse comercial. Atendimento pendente tem prioridade sobre nova oferta.
4. Em E-mails e campanhas, separar prospecção, automação e atendimento. Entrega não comprova leitura; validar captura de cliques antes de comparar mensagens.
5. Comparar compras confirmadas e receita no produto com o relatório do CRM. Não tratar acesso administrativo, cortesia ou teste como pagamento.
6. Escolher um obstáculo por produto prioritário, com responsável, mudança pequena e resultado verificável. Registrar a execução no tracker; evitar duplicar correções já entregues.

## Experimentos preparados para decisão

| Produto | Hipótese | Caminho existente | Medida principal |
|---|---|---|---|
| Barberias | Um convite claro ao gestor na home facilita a entrada correta | Home → teste ou planos → cadastro → configuração inicial | Contas prontas para agendar e primeiro agendamento; atribuição e janela precisam acompanhar a análise |
| AG LABS App | Objetivo concreto ajuda quem está com histórico vazio | Hub → post pronto ou produto em estúdio → revisão → geração | Início do fluxo (`use_case_started`, `step=empty-history`) e geração concluída; cliques não são criações |
| MeCard | Reduzir passos entre modelo e publicação melhora o primeiro uso | Modelo → editor → publicação | Usuários distintos com página publicada, não número de páginas |
| Viajeki | Facilitar a primeira viagem ajuda quem deseja organizar | Nova viagem → roteiro → convite | Criadores distintos; convidados podem participar sem criar viagem |
| Members | Resolver pendências de produtores permite lançar conteúdo | Cadastro de produtor → aprovação → publicação → venda | Produtores aprovados e vendas confirmadas; alunos não são produtores pendentes |

Para uma eventual divulgação, criar links com origem, meio, campanha e variante estáveis. Cada conteúdo deve levar à tarefa correspondente no aplicativo. Revisar textos e materiais antes da publicação. A comparação deve usar a mesma janela e unidade, sem somar pessoas entre aplicativos nem dividir estoques atuais para obter uma suposta conversão de coorte.

## Verificação depois de publicar

- CRM autenticado: abrir Ecossistema e confirmar que grupos só aparecem com coleta atual e disponível; conferir contagens no relatório do produto.
- AG LABS App: com conta sem histórico, abrir `/create`, seguir um dos objetivos e conferir a revisão de custo; não executar geração paga apenas para testar interface. Conferir que a orientação não aparece durante erro de histórico ou numa criação vinculada a projeto.
- Atribuição: simular falha de `/api/telemetry`; a origem permanece pendente e deve ser enviada numa próxima sessão. Confirmar que somente resposta HTTP de sucesso marca a entrega no navegador.
- Barberias: conferir CTAs da home no desktop e celular, parâmetros da campanha até `/signup` e ausência desse convite na página pública de uma barbearia.

Merge, deploy e verificação autenticada são etapas distintas. Uma publicação só deve ser descrita como validada na jornada depois da conferência no ambiente real.
