import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { httpProvider } from './campaign-executor.mjs';
import { brevoProvider } from './campaign-brevo';
const key = 'synthetic-key-not-real';
test('strict malformed provider receipts fail closed, never retry', async () => {
  for(const receipt of [null,{}, {messageId:2},{messageId:''},{messageId:'unstructured'}, {messageId:'<id@example.test>',extra:true},{messageId:'<bad\n@example.test>'},{messageId:'<bad\u0000@example.test>'}]) {
    let calls=0;
    const provider=brevoProvider({binding:binding as Parameters<typeof brevoProvider>[0]['binding'],apiKey:key,transport:async()=>{calls++;return Response.json(receipt,{status:201});}});
    await assert.rejects(provider.send(message)); assert.equal(calls,1);
  }
});
export const binding: Parameters<typeof brevoProvider>[0]['binding'] = { ownerId:'10000000-0000-0000-0000-000000000001', connectionId:'20000000-0000-0000-0000-000000000001', provider:'brevo', sourceKey:'crm.campaign.second', from:'sender@example.test', replyTo:'support@example.test', keySha256:createHash('sha256').update(key).digest('hex') };
test('provider timeout aborts once with no retry', async () => {
  let calls=0;
  const keepAlive=setTimeout(()=>{},6000);
  try {
    const provider=brevoProvider({binding,apiKey:key,transport:async(_input,init)=>{
      calls++;assert.ok(init?.signal);
      return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(Error('synthetic aborted transport')),{once:true}));
    }});
    await assert.rejects(provider.send(message));assert.equal(calls,1);
  } finally {clearTimeout(keepAlive);}
});
test('provider rejection, oversized JSON and additional message fields fail closed', async () => {
  for(const status of [200,202,400,429,500]) {
    let calls=0;const provider=brevoProvider({binding,apiKey:key,transport:async()=>{calls++;return Response.json({messageId:'<id@example.test>'},{status});}});
    await assert.rejects(provider.send(message));assert.equal(calls,1);
  }
  let calls=0;const provider=brevoProvider({binding,apiKey:key,transport:async()=>{calls++;return new Response(' '.repeat(4097),{status:201});}});
  await assert.rejects(provider.send(message));assert.equal(calls,1);
  await assert.rejects(provider.send({...message,html:'not approved'} as typeof message));assert.equal(calls,1);
});
test('invalid account/source/address bindings reject with zero HTTP', async () => {
  for(const patch of [{ownerId:null},{connectionId:''},{provider:'other'},{sourceKey:'other'},{from:'bad..local@example.test'},{replyTo:null},{keySha256:'wrong'}]) {
    let calls=0;const provider=brevoProvider({binding:{...binding,...patch} as typeof binding,apiKey:key,transport:async()=>{calls++;throw Error('unexpected');}});
    assert.throws(()=>provider.preflight());await assert.rejects(provider.send(message));assert.equal(calls,0);
  }
  for(const invalid of [null,undefined,{}]) {
    const provider=brevoProvider({binding:invalid as unknown as typeof binding,apiKey:key});assert.throws(()=>provider.preflight());
  }
});
test('immutable sender mismatch is rejected without HTTP', async () => {
  let calls=0;
  const provider=brevoProvider({binding:binding as Parameters<typeof brevoProvider>[0]['binding'],apiKey:key,transport:async()=>{calls++;return Response.json({messageId:'<id@example.test>'},{status:201});}});
  await assert.rejects(provider.send({...message,replyTo:'foreign@example.test'}));
  assert.equal(calls,0);
});
export const message = { from:binding.from, replyTo:binding.replyTo, to:'recipient@example.test', subject:'Approved subject', text:'Approved immutable text' };
test('Brevo sends fixed-origin mapped text payload and typed acceptance', async () => {
  const calls: {url:unknown;init:RequestInit}[]=[];
  const transport:typeof fetch=async(url,init)=>{calls.push({url,init:init!});return Response.json({messageId:'<20261102.123@smtp-relay.mailin.fr>'},{status:201});};
  // Executable pre-implementation baseline exposes the generic adapter's wrong payload.
  const factory = existsSync(new URL('./campaign-brevo.ts',import.meta.url)) ? (await import('./campaign-brevo')).brevoProvider : () => httpProvider({url:'https://api.brevo.com/v3/smtp/email',timeoutMs:5000});
  const original=globalThis.fetch; globalThis.fetch=transport;
  try {
    const provider=factory({binding,apiKey:key,transport}); provider.preflight();
    assert.deepEqual(await provider.send(message),{provider_message_id:'<20261102.123@smtp-relay.mailin.fr>'});
    assert.equal(calls.length,1); assert.equal(calls[0].url,'https://api.brevo.com/v3/smtp/email');
    assert.deepEqual(JSON.parse(calls[0].init.body as string),{sender:{email:binding.from},replyTo:{email:binding.replyTo},to:[{email:message.to}],subject:message.subject,textContent:message.text});
    assert.equal(new Headers(calls[0].init.headers).get('api-key'),key);
    assert.equal(calls[0].init.redirect,'error');
  } finally { globalThis.fetch=original; }
});
