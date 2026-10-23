import { handleMcp, mcpConfig } from '@/lib/mcp-server';
import { supabaseCrmStore } from '@/lib/mcp-store';

// Servidor MCP do CRM (docs/mcp.md). Autenticação por token em CRM_MCP_TOKENS.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = (request: Request) => handleMcp(request, { config: mcpConfig(), store: supabaseCrmStore });
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
