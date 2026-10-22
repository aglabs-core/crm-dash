# Reconciliação do estado das contas Barberias → CRM

Executar somente sob demanda, no console autenticado do container Barberias em `/app`, após publicar o receptor CRM com `account.access_granted` e aplicar a migration `20261022130000`. Não usar o endpoint do job de trial para fazer smoke.

O script lê o Prisma local e publica snapshots autenticados no CRM usando as envs já configuradas. Não altera conta, cobrança ou acesso no produto e não importa o EmailService. Não imprime payload, endereços ou credenciais. Acesso por cortesia não promove Cliente; status sem mapeamento é contado e deixado para revisão, nunca inventado como cancelamento. A chave é idempotente por conta/estado/updatedAt nesta reconciliação.

Antes de aplicar: conferir contagens e endereços duplicados por proprietário. O modelo atual mantém um estado agregado por contato, não deve receber snapshots contraditórios de múltiplas contas do mesmo dono sem conciliação.

Copiar o código para `/tmp/barberias-account-snapshot.cjs` no container e executar `node /tmp/barberias-account-snapshot.cjs` com diretório de trabalho `/app`. Depois conferir no CRM as contagens por `account_ref`, o estado e as notas da timeline.

```javascript
// Run inside the Barberias container. Reads product state and only writes CRM.
// No e-mail service, job endpoint, subscription mutation or payload logging.
const productRequire = require('node:module').createRequire(process.cwd() + '/package.json');
const { PrismaClient } = productRequire('@prisma/client');
const { resolveSubscriptionAccess } = productRequire('./backend/subscription-access.cjs');
const prisma = new PrismaClient();
(async () => {
  const url = process.env.CRM_ACCOUNT_EVENTS_URL;
  const token = process.env.CRM_ACCOUNT_EVENTS_TOKEN;
  if (!url || !token || token.length < 32) throw new Error('Publisher not configured');
  const now = new Date();
  const shops = await prisma.barberShop.findMany({select:{id:true,name:true,email:true,subscriptionStatus:true,
    subscriptionOverride:true,overrideExpiresAt:true,trialEndsAt:true,updatedAt:true,
    users:{where:{role:'ADMIN'},select:{email:true,firstName:true,lastName:true},orderBy:{createdAt:'asc'},take:1}}});
  const counts={accounts:shops.length,recorded:0,failed:0,missingEmail:0,unsupported:0,events:{}};
  for(const shop of shops){
    const email=(shop.email||shop.users[0]?.email||'').trim().toLowerCase();
    if(!email){counts.missingEmail++;continue;}
    const access=resolveSubscriptionAccess(shop,now);
    let event;
    if(['lifetime_override','gifted_without_expiry','gifted_override','legacy_lifetime_status'].includes(access.source)) event='account.access_granted';
    else if(access.source==='stripe_active') event='subscription.active';
    else if(access.source==='trialing') event='trial.started';
    else if(access.source==='trial_expired') event='trial.ended';
    else if(access.source==='canceled') event='subscription.canceled';
    else {counts.unsupported++;continue;}
    counts.events[event]=(counts.events[event]||0)+1;
    const key=`reconcile:2026-10-22:${shop.id}:${event}:${shop.updatedAt.toISOString()}`;
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({event,event_key:key,occurred_at:now.toISOString(),product:'barberias',account_ref:shop.id,
        account_name:shop.name,owner_email:email,owner_name:[shop.users[0]?.firstName,shop.users[0]?.lastName].filter(Boolean).join(' ')||null}),
      signal:AbortSignal.timeout(15000)});
    if(response.ok)counts.recorded++;else counts.failed++;
  }
  console.log('CRM_SYNC '+JSON.stringify(counts));
  if(counts.failed)process.exitCode=1;
})().catch(e=>{console.log('CRM_SYNC_ERROR '+JSON.stringify({name:e.name}));process.exitCode=1;}).finally(()=>prisma.$disconnect());

```
