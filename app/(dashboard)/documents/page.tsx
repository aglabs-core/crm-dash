import { ClientDocuments } from '@/components/ClientDocuments';

export default function DocumentsPage() {
  return <div className="mx-auto max-w-6xl space-y-5"><header><h1 className="text-xl font-semibold">Documentos</h1><p className="mt-1 text-sm text-muted">Contratos, notas e comprovantes vinculados aos clientes. Para anexar, abra a ficha do cliente.</p></header><ClientDocuments /></div>;
}
