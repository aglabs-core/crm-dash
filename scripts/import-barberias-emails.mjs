// Importa apenas a galeria fictícia já gerada pelo projeto. Não instancia provedores.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const source = process.argv[2];
if (!source) throw new Error('Informe o diretório do projeto Barberias.');
const gallery = join(source, 'output/emails');
const index = await readFile(join(gallery, 'index.html'), 'utf8');
const decode = (value) => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
const templates = [];
for (const match of index.matchAll(/<li><a href="([a-z-]+)\.html">([^<]+)<\/a>/g)) {
  const [, id, subject] = match;
  const html = await readFile(join(gallery, `${id}.html`), 'utf8');
  const text = await readFile(join(gallery, `${id}.txt`), 'utf8');
  if (!html.includes('Barbearia Exemplo') && !html.includes('Ana')) throw new Error(`Exemplo não reconhecido: ${id}`);
  if (/<script\b|<iframe\b|<form\b|\son[a-z]+\s*=/i.test(html)) throw new Error(`HTML ativo: ${id}`);
  templates.push({ id, subject: decode(subject), html, text });
}
if (templates.length !== 14) throw new Error('A galeria deve conter os 14 exemplos conhecidos.');
const renderer = await readFile(join(source, 'backend/email-template.cjs'));
const catalog = {
  sourceRepository: 'aglabs-core/Barber-PRO',
  sourceCommit: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  rendererSha256: createHash('sha256').update(renderer).digest('hex'),
  importedOn: new Date().toISOString().slice(0, 10),
  sourceFiles: ['backend/email-template.cjs', 'backend/EmailService.cjs', 'backend/trial-nurture.cjs', 'scripts/preview-emails.cjs'],
  templates,
};
await mkdir('lib/email-templates', { recursive: true });
await writeFile('lib/email-templates/barberias.json', `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Importados ${templates.length} exemplos fictícios. Nenhum envio realizado.`);
