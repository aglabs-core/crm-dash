import { receiveFeedbackEvent } from '@/lib/product-feedback';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => receiveFeedbackEvent(request);
