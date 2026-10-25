import { ecosystemOverview } from '@/lib/ecosystem';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;
export async function GET(request: Request) { return ecosystemOverview(request); }
