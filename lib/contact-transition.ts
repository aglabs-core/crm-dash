import { isActiveStatus, isClientStatus } from './constants';
import type { Contact, ContactStatus } from './types';
export const CLIENT_TRANSITION_MESSAGE = 'Clientes mantêm seu vínculo. Registre a nova necessidade na ficha com atividade e tarefa.';
export function isCustomerDowngrade(contact: Pick<Contact, 'status'>, status: ContactStatus, prospecting = false): boolean {
  return isClientStatus(contact.status) && (isActiveStatus(status) || prospecting);
}
