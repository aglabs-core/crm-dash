import { CampaignNavigation } from '@/components/CampaignNavigation';
import { EmailTemplateLibrary } from '@/components/EmailTemplateLibrary';

export default async function EmailTemplatesPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  return <div className="mx-auto max-w-7xl space-y-6">
    <div><h1 className="text-2xl font-bold text-fg">Modelos visuais de e-mail</h1><p className="mt-1 text-sm text-muted">Escolha a identidade da marca e personalize o conteúdo para cada campanha ou contato.</p></div>
    <CampaignNavigation active="templates" />
    <EmailTemplateLibrary product={product} />
  </div>;
}
