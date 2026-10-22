import { receiveResendWebhook } from '@/lib/resend-webhook';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => receiveResendWebhook(request);
