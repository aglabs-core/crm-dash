import { handleCampaignExecution } from '@/lib/campaign-execution';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) {
  return handleCampaignExecution(request, 'reconcile');
}
