import type { ContactInfo } from '@core/user/types';

const looksLikeEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Parse a Reply-To / address-list header value into contacts.
 * Supports `email`, `Name <email>`, and comma-separated lists.
 */
export const parseAddressList = (raw: string): ContactInfo[] => {
  const contacts: ContactInfo[] = [];
  let current = '';
  let inQuotes = false;
  let inAngles = false;

  const pushPart = (part: string) => {
    const trimmed = part.trim();
    if (!trimmed) return;

    const angled = trimmed.match(/^(.*?)\s*<([^>]+)>\s*$/);
    if (angled) {
      const email = angled[2].trim();
      if (!looksLikeEmail(email)) return;
      const name = angled[1].trim().replace(/^"|"$/g, '');
      contacts.push(name ? { email, name } : { email });
      return;
    }

    if (looksLikeEmail(trimmed)) {
      contacts.push({ email: trimmed });
    }
  };

  for (const char of raw) {
    if (char === '"' && !inAngles) {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === '<' && !inQuotes) {
      inAngles = true;
      current += char;
      continue;
    }
    if (char === '>' && !inQuotes) {
      inAngles = false;
      current += char;
      continue;
    }
    if (char === ',' && !inQuotes && !inAngles) {
      pushPart(current);
      current = '';
      continue;
    }
    current += char;
  }
  pushPart(current);
  return contacts;
};

export const isUsableContactEmail = (contact: {
  email?: string | null;
}): boolean =>
  typeof contact?.email === 'string' && looksLikeEmail(contact.email.trim());
