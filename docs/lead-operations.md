# Organização de leads e funil — primeira evolução

Entradas do site são opt-in institucional e permanecem em `leads_institucional`; as filas Aguardando triagem e Em contato não significam venda. Converter mantém a RPC existente e sua resolução de identidade. Prospecção é a carteira fria em `contacts.prospecting_pool`, fora do funil. Revisão pendente exige verificar origem, contexto, permissão e bloqueios; apto é revisão cadastral, não autorização automática de disparo. Não contatar acompanha a pessoa mesmo quando produto ou etapa muda.

Os filtros usam apenas produto e origem existentes. Produto a definir inclui campo vazio. A dimensão de aplicação ainda não é independente: aplicações aparecem somente quando registradas como produto. A estrutura de campanhas existente é descrita em [email-campaigns.md](email-campaigns.md); esta entrega não infere associação de contatos a campanhas a partir de produto ou origem. As filas de prospecção respeitam produto/origem; contadores não são reduzidos pela busca textual. A seleção em massa é limpa ao trocar filtros para evitar ações sobre contatos ocultos.

## Critérios operacionais de avanço

- Lead: interesse identificado, aguardando atendimento. Base fria não entra por ter recebido saudação.
- Contatado: abordagem realizada e registrada, sem presumir resposta.
- Atendimento: conversa real com contexto/necessidade identificados.
- Proposta: oferta concreta discutida e enviada, com próxima tarefa.
- Pagamento: decisão comercial e cobrança combinadas; não basta abrir email.
- Cliente: confirmação confiável de contratação/pagamento. `payment_transactions` continua fonte financeira, `contacts.amount` é estimativa.
- Arquivado: oportunidade encerrada com motivo; contato frio bloqueado não é perda comercial.

Estes são critérios de operação, não novos bloqueios automáticos. Cliente com nova necessidade mantém vínculo/status; registrar atividade factual e tarefa com responsável/prazo até existir modelo de contratações concorrentes.

## Acompanhamento no funil

Cartões mostram a tarefa pendente de menor prazo (incluindo vencidas; sem prazo fica depois), seu responsável e acesso à ficha para criar/editar tarefas. O responsável é da tarefa, não um dono presumido do contato. O atalho Sem próxima tarefa depende de consulta bem-sucedida. Falha no contexto é explicitada, sem afirmar ausência de tarefas.

Última interação considera atividades followup/suporte/meeting com canal diferente de sistema e data válida. É um registro operacional, não prova de resposta ou intenção. Notas, disparos, boas-vindas e mudanças de etapa não reiniciam o indicador. Dias sem interação registrada não são tempo na etapa: `updated_at` não é usado. Ausência de atividade não produz data inventada. Consultas são paginadas, autenticadas e sujeitas à RLS existente; sem migração ou chave privilegiada.

## Próximas fases (não implementadas)

Confirmar mapeamento de AG LABS/Barberias, produtos e provedores Brevo/Resend; definir permissão/supressão por canal e reconciliação de identidade. A estrutura de rascunhos, destinatários e eventos já existe; confirmar aplicação da migration e integração server-side antes de usar entrega/falhas, respostas e atribuição de resultado como dados operacionais. Aberturas/cliques são sinais auxiliares, nunca qualificação ou compra. Contratações simultâneas e entrada histórica em etapa exigem modelo próprio e migração. Nenhum email, campanha ou integração foi ativado nesta entrega.

## Correções após revisão independente

Datas de calendário (`DATE`) são formatadas no dia local, enquanto timestamps mantêm seu fuso. A proteção do vínculo de Cliente/Inativo é compartilhada entre edição individual, ações em massa, formulário do funil, movimentação e promoção pela ficha; Cliente ↔ Inativo e arquivamento continuam possíveis.

O carregamento dos contatos libera os cartões antes do contexto. Tarefas/atividades têm atualização realtime separada e não recarregam a carteira. O contexto usa relações embutidas do PostgREST, filtradas e ordenadas no servidor, com limite de uma tarefa pendente e uma interação por contato. Paginação por ID continua até página vazia, inclusive quando o servidor retorna páginas menores que 500. Para 1.000 contatos, com limite padrão, são três requisições de resumo, sem baixar histórico completo nem tarefas concluídas. RLS permanece em cada relação. Atualização/unmount aborta a consulta anterior; respostas ou erros atrasados não substituem o contexto atual. Falha mantém acompanhamento indisponível, sem declarar ausência de tarefas. Se o filtro de tarefas já estava ativo, a tela avisa que está mostrando todos os contatos e permite desligá-lo.

Validação de consulta usa o cliente Supabase real com transporte HTTP sintético (parâmetros, paginação, erro e cancelamento). Não substitui execução autenticada contra PostgREST em produção; relações e políticas reais ainda precisam desse teste antes da publicação.
