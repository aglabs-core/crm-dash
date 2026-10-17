import { associateBrevoMessage } from '@/lib/brevo-association';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => associateBrevoMessage(request);
