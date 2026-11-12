/** Public release receipt only; never probes or returns customer data. */
export const dynamic = 'force-dynamic';
export async function GET() {
  const sha=process.env.CRM_BUILD_COMMIT || '';
  return Response.json({ ok:true, app:'crm-dash', commit:/^[a-f0-9]{40}$/.test(sha) ? sha : null }, { headers:{'Cache-Control':'no-store'} });
}
