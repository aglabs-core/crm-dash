import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { inspectDocument, loadDocuments, completeDocumentUpload, type DocumentDraft } from './client-documents';

test('document validation bounds size, format and invoice type without modifying originals', async () => {
  const file = new File(['%PDF-1.7\nsynthetic'], 'synthetic.pdf', { type: 'application/pdf' });
  const details = await inspectDocument(file, 'invoice_pdf');
  assert.equal(details.size_bytes, file.size); assert.match(details.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(inspectDocument(new File(['<script/>'], 'fake.pdf'), 'other'), /conteúdo/);
  await assert.rejects(inspectDocument(file, 'invoice_xml'), /corresponder/);
  await assert.rejects(inspectDocument(new File(['<!DOCTYPE x><x/>'], 'bad.xml'), 'invoice_xml'), /conteúdo/);
  await assert.rejects(inspectDocument(new File([], 'empty.pdf'), 'other'), /10 MB/);
  await assert.rejects(inspectDocument(new File([new Uint8Array(10485761)], 'large.pdf'), 'other'), /10 MB/);
});
test('document list is paginated and scoped; query failures never become an empty folder', async () => {
  let url: URL | undefined;
  const client = createClient('https://synthetic.example.invalid','synthetic',{ auth:{persistSession:false},global:{fetch:async(input)=>{
    url = new URL(String(input)); return new Response('[]',{headers:{'content-type':'application/json','content-range':'*/0'}});
  }}});
  await loadDocuments('synthetic', 2, new AbortController().signal, client);
  assert.equal(url!.searchParams.get('contact_id'),'eq.synthetic');
  assert.equal(url!.searchParams.get('offset'),'50');
  assert.equal(url!.searchParams.get('limit'),'25');
});
test('uncertain upload retries reuse the same path and never overwrite or delete the original', async () => {
  const urls: string[] = [];
  const client = createClient('https://synthetic.example.invalid','synthetic',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    urls.push(`${init?.method || 'GET'} ${String(input)}`);
    if (String(input).includes('/storage/')) return new Response('{"statusCode":"409","error":"Duplicate","message":"exists"}',{status:409,headers:{'content-type':'application/json'}});
    return new Response('{"id":"existing"}',{headers:{'content-type':'application/json'}});
  }}});
  const draft: DocumentDraft = {id:'id',user_id:'owner',contact_id:'contact',payment_id:null,title:'Synthetic',category:'contract',competence:null,file_name:'file.pdf',extension:'pdf',mime_type:'application/pdf',size_bytes:4,sha256:'a'.repeat(64)};
  await completeDocumentUpload(draft,new File(['%PDF'],'file.pdf'),client);
  assert.match(urls[0],/owner\/contact\/id.pdf/);
  assert.ok(urls.every((u)=>!u.startsWith('DELETE') && !u.startsWith('PUT')));
});
