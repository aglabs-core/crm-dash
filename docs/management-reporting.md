# Relatórios, qualidade de dados e jornadas

`/reports` consulta `crm_management_report` por produto e janela. A função é
`SECURITY INVOKER`: usa a mesma RLS do proprietário/administrador. Retorna só
agregados, sem nomes, canais, documentos, IDs de pagamento ou cadastros. O CSV
da tela também contém apenas resumo por produto.

## Indicadores

- Contatos: coorte por criação; base fria e `Contato` ficam fora dos resultados comerciais.
- Etapas: distribuição atual, sem inferir passagem por etapas anteriores.
- Ganhos entre fechados: Cliente/Inativo sobre Cliente/Inativo/Arquivado.
- Financeiro: pagamentos BRL após devoluções/contestações, antes de taxas e tributos;
  não comprova liquidação. Mês em `America/Sao_Paulo`. Pagamentos sem data só
  entram no total histórico, não em janelas datadas. Devoluções continuam
  acumuladas no pagamento original; não são um fluxo de caixa de estornos.
- Qualidade cadastral: base completa do produto; pagamentos: janela selecionada.
  Identidade compartilhada significa e-mail normalizado ou mesmos dígitos de
  telefone/WhatsApp em contatos distintos. Não resolve DDI nem mescla pessoas.

## Jornada observada

`contact_stage_events` registra criação e mudança real de status a partir da
instalação de `20261112113000_structured_journey.sql`. O estágio canônico
continua exclusivamente em `contacts.status`. Não há backfill inventado.

`crm_journey_report` acompanha novos contatos criados como Lead após o início
da cobertura, e calcula quantos têm entrada registrada em Cliente. A taxa usa
a mesma coorte no denominador e numerador. Registros anteriores, contatos que
entraram diretamente em Cliente e base fria ficam fora. O histórico não
significa pagamento. Conversão e tempo médio continuam evoluindo enquanto
os negócios estão abertos. Tempos por etapa consideram só intervalos encerrados.

## Publicação e compatibilidade

Aplicar primeiro as migrations de jornada e relatórios com `supabase db push`.
Depois publicar o código, conferir filtros, isolamento entre proprietários e
indicadores. `GET /api/health` informa o SHA do build sem dados de clientes;
comparar com o commit aprovado após o deploy. Se a função ainda não existe (`PGRST202`/`42883`), a tela usa a
leitura anterior com projeção comercial mínima e avisa que está em modo de
compatibilidade. Qualidade avançada e jornada ficam indisponíveis, nunca zero.
Falhas de autorização, rede ou SQL não ativam esse fallback.

## Validação contínua

Cada mudança precisa de regressão para o defeito e evidência da versão em
produção. Usar fixtures sintéticas para limites de paginação, concorrência,
fronteira de mês, falha de fonte, filtros e RLS. Medir navegação e tempo da
consulta com o mesmo volume antes/depois; o build ou skeleton não mede latência
autenticada. Não usar mensagens, cobranças ou pagamentos reais como testes.
