import { isActiveStatus, isClientStatus } from './constants';
import type { ContactRollup } from './contact-directory';

/** Exclusive commercial buckets; an app account never implies a paid customer. */
export function operationsSummary(rows: ContactRollup[]) {
  const totals = { cold: 0, qualification: 0, pipeline: 0, clients: 0, archived: 0, unclassified: 0, missingProduct: 0, outreachReview: 0 };
  for (const row of rows) {
    const count = Number(row.total);
    if (!row.produto?.trim()) totals.missingProduct += count;
    if (row.prospecting_pool) {
      totals.cold += count;
      if (!row.outreach_status || row.outreach_status === 'unreviewed') totals.outreachReview += count;
    } else if (row.status === 'Contato') totals.qualification += count;
    else if (isActiveStatus(row.status)) totals.pipeline += count;
    else if (isClientStatus(row.status)) totals.clients += count;
    else if (row.status === 'Arquivado') totals.archived += count;
    else totals.unclassified += count;
  }
  return totals;
}
