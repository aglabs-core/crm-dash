# Organização operacional do CRM

## Critérios comerciais

Contato é a ficha da pessoa. Captura de WhatsApp, comentário e pedido de material não provam intenção de compra. A base sem interesse comercial fica em Prospecção, fora dos indicadores comerciais. Qualificar exige registrar necessidade, produto e interesse em conversar sobre a solução. Mover para Lead inicia o funil; Contatado significa abordagem comercial enviada, não conversa de suporte. Atendimento significa conversa comercial; Proposta e Pagamento exigem os respectivos acontecimentos reais.

A representação atual da base usa prospecting_pool=true com status Arquivado. O rótulo mostrado é Prospecção; esse registro não conta como perda. Não classificar retroativamente por ausência de nome ou produto, pois isso não é evidência de desqualificação.

## Correção a encaminhar ao agente da VPS

A migration 20260925065006 define maia_whatsapp_intake com INSERT em contacts preenchendo whatsapp, phone=NULL, name=NULL e status=Contatado. Isso explica o número ausente na interface antiga e pode contaminar o funil. Conferir a função realmente implantada antes de alterar. Intake deve criar uma ficha fora do funil; apenas qualificação comercial deve promovê-la. Revisar também maia_whatsapp_contact: a ordenação monotônica dos status pode impedir correções legítimas e não deve promover atendimento genérico.

Instagram: registrar_lead_instagram cria status Lead a partir de captura; a migration 20260925190915 adiciona deduplicação de evento e reserva da oferta. Isso documenta o contrato, mas não comprova execução ou entrega em produção. Conferir workflow, eventos agregados, erros, atualização de oferta e promoção comercial. Comentário pedindo material autoriza contexto do material, não indica compra. Após entregar, uma pergunta contextual possível: “Você pretende usar isso no seu negócio ou está explorando por enquanto?”. Registrar a resposta antes de qualificar. Nenhum envio foi realizado nesta revisão.

## Reembolsos

Preservar o histórico da compra e a transação reembolsada. Sem outra compra válida ou contrato ativo, apresentar como cliente inativo, não apagar nem retornar a Lead. A receita deve vir do livro de pagamentos, descontando reembolso; revogação de acesso pertence ao produto. O caso mencionado pelo usuário não foi consultado nem alterado no banco nesta revisão.

## Limites da verificação

O projeto configurado localmente não está acessível à conexão Supabase deste chat; consulta agregada foi recusada. Não houve leitura de dados pessoais, alteração de dados reais, migração, publicação ou verificação autenticada. O checkout inicial estava oito commits atrás de origin/main. A revisão foi integrada à base atual: a página de status Integrações sai da navegação e redireciona para Campanhas; os endpoints Brevo são preservados. Campanhas tem uma única ação de criação. O domínio informado abriu em /login nesta sessão.

Dashboard e relatórios usam contatos paginados e livro de pagamentos. Receita líquida por data de pagamento não é saldo bancário: reembolsos reduzem a venda original, não formam uma série de fluxo de caixa por data do estorno. Funil acumulado é inferido do estágio atual e não comprova passagem histórica por todas as etapas. Conversão usa o estado atual dos encerrados; não é coorte histórica.
