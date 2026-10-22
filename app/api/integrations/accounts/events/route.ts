import { receiveAccountEvent } from '@/lib/account-events';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => receiveAccountEvent(request);
