import type { Contact } from './types';
import { isActiveStatus, isClientStatus } from './constants';
export const MAX_CAMPAIGN_SELECTION = 200;
export type AudienceSegment = 'all' | 'prospecting' | 'pipeline' | 'clients';
export function campaignProductKey(value?: string | null): string {
  const key = value?.trim().toLowerCase() || '';
  return key === 'barberpro' ? 'barberias' : key;
}
export function campaignAudience(contacts: Contact[], owner: string, product: string, existing: Set<string>) {
  const seenEmails = new Set<string>();
  return contacts.filter((contact) => contact.user_id === owner
    && campaignProductKey(contact.produto) === campaignProductKey(product)).map((contact) => {
    const email = contact.email?.trim().toLowerCase() || '';
    let reason = '';
    if (existing.has(contact.id)) reason = 'Já está na campanha';
    else if (contact.outreach_status === 'blocked') reason = 'Não contatar';
    else if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reason = 'Sem e-mail válido';
    else if (contact.outreach_status !== 'contactable') reason = 'Revisão pendente';
    else if (seenEmails.has(email)) reason = 'E-mail repetido';
    if (!reason) seenEmails.add(email);
    return { contact, reason };
  });
}
export function inAudienceSegment(contact: Contact, segment: AudienceSegment) {
  if (segment === 'all') return true;
  if (segment === 'prospecting') return !!contact.prospecting_pool;
  if (segment === 'pipeline') return !contact.prospecting_pool && isActiveStatus(contact.status);
  return !contact.prospecting_pool && isClientStatus(contact.status);
}
export function personalizePreview(text: string, name: string | null, product: string) {
  return text.replaceAll('{{nome}}', name?.trim() || 'você').replaceAll('{{produto}}', product);
}
