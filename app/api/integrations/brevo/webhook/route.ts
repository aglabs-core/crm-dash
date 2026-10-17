import { receiveBrevoWebhook } from '@/lib/brevo-receiver';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => receiveBrevoWebhook(request);
