// Mapa único da navegação: cada seção do menu lateral agrupa as telas que tratam do
// mesmo assunto, e as telas de uma seção aparecem como abas. As rotas não mudam.

export type NavTab = { label: string; href: string };
export type NavSectionId = 'overview' | 'contacts' | 'pipeline' | 'tasks' | 'email' | 'finance';
export type NavSection = { id: NavSectionId; label: string; href: string; tabs?: NavTab[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'overview',
    label: 'Visão geral',
    href: '/',
    tabs: [
      { label: 'Dashboard', href: '/' },
      { label: 'Carteira', href: '/operations' },
      { label: 'Produtos', href: '/ecosystem' },
      { label: 'Relatórios', href: '/reports' },
    ],
  },
  {
    id: 'contacts',
    label: 'Contatos',
    href: '/contacts',
    tabs: [
      { label: 'Contatos', href: '/contacts' },
      { label: 'Entradas do site', href: '/leads' },
      { label: 'Clientes', href: '/clients' },
    ],
  },
  { id: 'pipeline', label: 'Funil', href: '/deals' },
  {
    id: 'tasks',
    label: 'Tarefas',
    href: '/tasks',
    tabs: [
      { label: 'Tarefas', href: '/tasks' },
      { label: 'Central de ações', href: '/actions' },
    ],
  },
  // As abas de Campanhas e Templates ficam com a própria área de e-mails.
  { id: 'email', label: 'E-mails', href: '/campaigns' },
  {
    id: 'finance',
    label: 'Financeiro',
    href: '/finance',
    tabs: [
      { label: 'Recebimentos', href: '/finance' },
      { label: 'Documentos', href: '/documents' },
    ],
  },
];

export function matchesHref(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Seção a que a rota pertence; busca e configurações não pertencem a nenhuma. */
export function sectionOf(pathname: string): NavSection | undefined {
  return NAV_SECTIONS.find((section) =>
    (section.tabs ?? [{ label: section.label, href: section.href }]).some((tab) => matchesHref(pathname, tab.href)),
  );
}

/** Abas a exibir: só nas telas principais da seção, nunca em uma ficha ou subpágina. */
export function tabsFor(pathname: string): NavTab[] {
  const tabs = sectionOf(pathname)?.tabs ?? [];
  return tabs.some((tab) => tab.href === pathname) ? tabs : [];
}
