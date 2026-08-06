const { spawnSync } = require('node:child_process');

// Portão de auditoria de dependências de produção.
//
// `npm audit` sozinho não serve de portão: um único aviso que não se aplica ao
// projeto deixa o CI vermelho para sempre e todo mundo aprende a ignorar. Aqui
// cada exceção é explícita, justificada e tem data de revisão — qualquer aviso
// novo continua reprovando.

const exceptions = [
  {
    package: 'postcss',
    ids: ['GHSA-6g55-p6wh-862q', 'GHSA-r28c-9q8g-f849'],
    reason:
      'postcss vem embutido no Next 15 e roda em tempo de build. Os vetores exigem CSS '
      + 'controlado por atacante; aqui o CSS vem do repositório e do Tailwind. A correção é '
      + 'Next 16, migração planejada.',
    reviewBy: '2026-11-30',
  },
  {
    package: 'sharp',
    ids: ['GHSA-f88m-g3jw-g9cj'],
    reason:
      'sharp <0.35 herda CVEs do libvips e vem embutido no Next 15. Este tem caminho de '
      + 'entrada real: o Next otimiza os avatares vindos do Supabase Storage. É o aviso que '
      + 'justifica priorizar a migração para o Next 16 — revisão curta de propósito.',
    reviewBy: '2026-09-30',
  },
];

const blockedSeverities = new Set(['high', 'critical']);
const onWindows = process.platform === 'win32';

const result = spawnSync(onWindows ? 'npm.cmd' : 'npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  // No Windows, o Node recusa executar .cmd sem shell desde a correção de
  // CVE-2024-27980. Os argumentos aqui são fixos, então o shell é seguro.
  shell: onWindows,
});

// `npm audit` sai com código diferente de zero quando encontra algo. O que
// importa aqui é o JSON; falta de JSON é que é erro de execução.
if (!result.stdout) {
  console.error('FALHA - npm audit não retornou saída.');
  console.error(result.stderr || result.error?.message || 'motivo desconhecido');
  process.exitCode = 1;
  return;
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('FALHA - não foi possível interpretar a saída de npm audit.');
  process.exitCode = 1;
  return;
}

const advisoryId = (url) => {
  const match = /GHSA-[a-z0-9-]+/i.exec(url || '');
  return match ? match[0] : null;
};

const findings = [];
for (const vulnerability of Object.values(report.vulnerabilities || {})) {
  if (!blockedSeverities.has(vulnerability.severity)) continue;
  for (const via of vulnerability.via || []) {
    if (typeof via === 'string') continue;
    if (!blockedSeverities.has(via.severity)) continue;
    const id = advisoryId(via.url);
    if (findings.some((item) => item.id === id && item.package === vulnerability.name)) continue;
    findings.push({
      id,
      package: vulnerability.name,
      severity: via.severity,
      title: via.title,
      url: via.url,
    });
  }
}

const today = new Date().toISOString().slice(0, 10);
const matched = new Set();
const blocking = [];

for (const finding of findings) {
  const exception = exceptions.find(
    (item) => item.package === finding.package && item.ids.includes(finding.id),
  );
  if (!exception) {
    blocking.push(finding);
    continue;
  }
  matched.add(finding.id);
  console.log(`EXCEÇÃO - ${finding.package}: ${finding.id} (${finding.severity})`);
  if (today > exception.reviewBy) {
    console.warn(`AVISO - exceção de ${exception.package} passou da data de revisão (${exception.reviewBy}).`);
  }
}

for (const exception of exceptions) {
  const stale = exception.ids.filter((id) => !matched.has(id));
  if (stale.length === exception.ids.length) {
    console.warn(`AVISO - nenhuma exceção de ${exception.package} corresponde a aviso atual. Remover.`);
  } else if (stale.length > 0) {
    console.warn(`AVISO - exceções de ${exception.package} sem aviso correspondente: ${stale.join(', ')}. Remover.`);
  }
}

for (const finding of blocking) {
  console.error(`FALHA - ${finding.package}: ${finding.title} (${finding.severity})`);
  console.error(`        ${finding.url}`);
}

if (blocking.length > 0) {
  console.error(`\nAuditoria reprovada: ${blocking.length} aviso(s) alto ou crítico sem exceção registrada.`);
  process.exitCode = 1;
} else {
  console.log(`\nAuditoria aprovada: ${findings.length} aviso(s) avaliado(s), ${matched.size} exceção(ões) aplicada(s).`);
}
