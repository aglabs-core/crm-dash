import { spawnSync } from 'node:child_process';

// Portão de auditoria de dependências de produção.
//
// `npm audit` sozinho não serve de portão: um único aviso que não se aplica ao
// projeto deixa o CI vermelho para sempre e todo mundo aprende a ignorar. Aqui
// cada exceção é explícita, justificada e tem data de revisão — qualquer aviso
// novo continua reprovando.
//
// Hoje a lista está vazia: o projeto não tem nenhum aviso alto ou crítico.

const exceptions = [];

const blockedSeverities = new Set(['high', 'critical']);
const onWindows = process.platform === 'win32';

function carregarRelatorio() {
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
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    console.error('FALHA - não foi possível interpretar a saída de npm audit.');
    return null;
  }
}

function extrairAchados(report) {
  const idDoAviso = (url) => {
    const match = /GHSA-[a-z0-9-]+/i.exec(url || '');
    return match ? match[0] : null;
  };

  const achados = [];
  for (const vulnerability of Object.values(report.vulnerabilities || {})) {
    if (!blockedSeverities.has(vulnerability.severity)) continue;
    for (const via of vulnerability.via || []) {
      if (typeof via === 'string') continue;
      if (!blockedSeverities.has(via.severity)) continue;
      const id = idDoAviso(via.url);
      if (achados.some((item) => item.id === id && item.package === vulnerability.name)) continue;
      achados.push({
        id,
        package: vulnerability.name,
        severity: via.severity,
        title: via.title,
        url: via.url,
      });
    }
  }
  return achados;
}

const report = carregarRelatorio();
if (!report) {
  process.exitCode = 1;
} else {
  const achados = extrairAchados(report);
  const hoje = new Date().toISOString().slice(0, 10);
  const aplicadas = new Set();
  const bloqueiam = [];

  for (const achado of achados) {
    const excecao = exceptions.find(
      (item) => item.package === achado.package && item.ids.includes(achado.id),
    );
    if (!excecao) {
      bloqueiam.push(achado);
      continue;
    }
    aplicadas.add(achado.id);
    console.log(`EXCEÇÃO - ${achado.package}: ${achado.id} (${achado.severity})`);
    if (hoje > excecao.reviewBy) {
      console.warn(`AVISO - exceção de ${excecao.package} passou da data de revisão (${excecao.reviewBy}).`);
    }
  }

  for (const excecao of exceptions) {
    const orfas = excecao.ids.filter((id) => !aplicadas.has(id));
    if (orfas.length === excecao.ids.length) {
      console.warn(`AVISO - nenhuma exceção de ${excecao.package} corresponde a aviso atual. Remover.`);
    } else if (orfas.length > 0) {
      console.warn(`AVISO - exceções de ${excecao.package} sem aviso correspondente: ${orfas.join(', ')}. Remover.`);
    }
  }

  for (const achado of bloqueiam) {
    console.error(`FALHA - ${achado.package}: ${achado.title} (${achado.severity})`);
    console.error(`        ${achado.url}`);
  }

  if (bloqueiam.length > 0) {
    console.error(`\nAuditoria reprovada: ${bloqueiam.length} aviso(s) alto ou crítico sem exceção registrada.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAuditoria aprovada: ${achados.length} aviso(s) avaliado(s), ${aplicadas.size} exceção(ões) aplicada(s).`);
  }
}
