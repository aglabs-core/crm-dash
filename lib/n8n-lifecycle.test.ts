import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const plan = JSON.parse(readFileSync('integrations/n8n/workflow-updates.json','utf8')) as {updates:{nodeName:string;parameters:{jsCode:string}}[]};
const code = (name:string) => plan.updates.find(row=>row.nodeName===name)!.parameters.jsCode;
const validate = (body:Record<string,unknown>) => new Function('$json',code('Validar entrada'))({body})[0].json;
test('Maia generic conversation never defaults to Atendimento or commercial interest', () => {
  const result=validate({whatsapp:'5511999990001',summary:'Conversa de atendimento comum.',status:'Atendimento'});
  assert.equal(result.status,'Contato'); assert.equal(result.name,null); assert.equal(result.produto,null);
});
test('Maia qualification requires product and factual evidence, without sensitive fields', () => {
  assert.throws(()=>validate({whatsapp:'5511999990001',summary:'Consulta comercial.',status:'Lead',commercial_intent:true}));
  const result=validate({whatsapp:'5511999990001',summary:'Consulta comercial.',product:'Synthetic',status:'Lead',commercial_intent:true,qualification_reason:'Solicitou proposta de site para a empresa.'});
  assert.equal(result.status,'Lead'); assert.match(result.summary,/Qualificação comercial:/);
  assert.throws(()=>validate({whatsapp:'5511999990001',summary:'Consulta comercial.',product:'Synthetic',status:'Lead',commercial_intent:true,qualification_reason:'password particular informado'}));
});
test('n8n Asaas accepts completed refund events and ignores an in-progress refund', () => {
  const extract = new Function('$json',code('Extrair Asaas'));
  assert.equal(extract({body:{event:'PAYMENT_REFUNDED',payment:{id:'synthetic'}}})[0].json.event,'PAYMENT_REFUNDED');
  assert.deepEqual(extract({body:{event:'PAYMENT_REFUND_IN_PROGRESS',payment:{id:'synthetic'}}}),[]);
});
