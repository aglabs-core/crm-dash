// Contact-name presentation, kept separate from persisted identity.
export function contactNameInput(name: string | null | undefined): string {
  return name ?? '';
}

export function contactNamePayload(value: string): string | null {
  return value.trim() || null;
}

export function contactMatchesSearch(
  contact: { name: string | null; company?: string | null },
  query: string,
): boolean {
  const term = query.toLowerCase();
  return (contact.name ?? '').toLowerCase().includes(term) ||
    (contact.company?.toLowerCase().includes(term) ?? false);
}

export function contactName(name: string | null | undefined): string {
  return name?.trim() || 'Sem nome';
}

export function contactInitials(name: string | null | undefined): string {
  return name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}
