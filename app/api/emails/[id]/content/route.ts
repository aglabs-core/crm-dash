import { getEmailContent } from '@/lib/email-content';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return getEmailContent(request, (await params).id);
}
