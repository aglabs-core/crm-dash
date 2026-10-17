import Link from 'next/link';

export function CampaignNavigation({ active }: { active: 'campaigns' | 'templates' }) {
  return <nav aria-label="Campanhas e templates" className="flex gap-1 border-b border-border">
    {[['campaigns', '/campaigns', 'Campanhas'], ['templates', '/campaigns/templates', 'Templates de e-mail']].map(([id, href, label]) =>
      <Link key={id} href={href} aria-current={active === id ? 'page' : undefined}
        className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${active === id ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg'}`}>{label}</Link>)}
  </nav>;
}
