import { createHash } from 'node:crypto';

/** Only privileged server configuration supplies this approval; never request data. */
export type BrevoBinding = { ownerId:string; connectionId:string; provider:'brevo'; sourceKey:'crm.campaign.second'; from:string; replyTo:string; keySha256:string };
export type ApprovedMessage = {from:string;replyTo:string;to:string;subject:string;text:string};
export function brevoProvider({ binding, apiKey, transport = fetch }: { binding:BrevoBinding; apiKey:string; transport?:typeof fetch }) {
  const frozen = binding && Object.freeze({...binding});
  function preflight() {
    if (!validBinding(frozen) || typeof apiKey!=='string' || !apiKey || apiKey.length>1000 || /[\r\n]/.test(apiKey) || providerKeyDigest(apiKey)!==frozen.keySha256) throw Error('Invalid provider binding');
  }
  function validateMessage(message:ApprovedMessage) {
    preflight();
    if (!message || Object.keys(message).sort().join(',')!=='from,replyTo,subject,text,to'
      || message.from!==frozen.from || message.replyTo!==frozen.replyTo || !validAddress(message.to)
      || typeof message.subject!=='string' || !message.subject.trim() || message.subject.length>998 || /[\r\n]/.test(message.subject)
      || typeof message.text!=='string' || !message.text.trim() || message.text.length>100000) throw Error('Immutable message binding mismatch');
  }
  return {
    preflight, validateMessage,
    async send(message:ApprovedMessage):Promise<{provider_message_id:string}> {
      validateMessage(message);
      const response=await transport('https://api.brevo.com/v3/smtp/email',{
        method:'POST',redirect:'error',cache:'no-store',headers:{'api-key':apiKey,'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify({sender:{email:frozen.from},replyTo:{email:frozen.replyTo},to:[{email:message.to}],subject:message.subject,textContent:message.text}),
        signal:AbortSignal.timeout(5000),
      });
      if(response.status!==201) throw Error('Provider outcome uncertain');
      const reader=response.body?.getReader();
      if(!reader) throw Error('Provider outcome uncertain');
      const chunks:Uint8Array[]=[]; let size=0;
      for(;;) {
        const part=await reader.read(); if(part.done) break;
        size+=part.value.length;
        if(size>4096) {await reader.cancel();throw Error('Provider outcome uncertain');}
        chunks.push(part.value);
      }
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).join(',')!=='messageId'
        || typeof body.messageId!=='string' || body.messageId.length>500 || !/^<[\x21-\x3b\x3d\x3f\x41-\x7e]+@[A-Za-z0-9.-]+>$/.test(body.messageId)) throw Error('Provider outcome uncertain');
      return {provider_message_id:body.messageId};
    },
  };
}
// Reused by the server configuration preflight in the next vertical.
export const uuid = (value:unknown):value is string => typeof value==='string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
export const validAddress=(value:unknown):value is string=>typeof value==='string' && value.length<=320 && /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value);
export function validBinding(value:unknown):value is BrevoBinding {
  if (!value || typeof value!=='object' || Array.isArray(value)) return false;
  const b=value as BrevoBinding;
  return Object.keys(b).sort().join(',')==='connectionId,from,keySha256,ownerId,provider,replyTo,sourceKey' && uuid(b.ownerId) && uuid(b.connectionId)
    && b.provider==='brevo' && b.sourceKey==='crm.campaign.second' && validAddress(b.from) && validAddress(b.replyTo)
    && typeof b.keySha256==='string' && /^[a-f0-9]{64}$/.test(b.keySha256);
}
export const providerKeyDigest=(key:string)=>createHash('sha256').update(key).digest('hex');
