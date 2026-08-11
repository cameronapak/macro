import {
  type ExtractedContactInfo,
  recipientEntityMapper,
} from '@core/user/combinedRecipient';
import type { ContactInfo } from '@core/user/types';
import { emailToId } from '@core/user/util';
import type { ApiMessage } from '@service-email/generated/schemas';
import type { EmailRecipient } from '../component/EmailContext';
import {
  isUsableContactEmail,
  parseAddressList,
} from './parseAddressList';

const extractedContactInfo = (contact: ContactInfo): ExtractedContactInfo => ({
  ...contact,
  id: emailToId(contact.email),
  type: 'extracted',
});

export const convertEmailRecipientToContactInfo = (
  item: EmailRecipient
): ContactInfo => {
  switch (item.kind) {
    case 'user':
      return { email: item.data.email, name: item.data.name };
    case 'contact':
      return item.data;
    case 'custom':
      return { email: item.data.email };
  }
};

export const convertContactInfoToEmailRecipient = (
  contact: ContactInfo
): EmailRecipient => {
  return recipientEntityMapper('contact')(extractedContactInfo(contact));
};

/** ApiMessage may gain a first-class reply_to field; prefer it when present. */
type ApiMessageWithReplyTo = ApiMessage & {
  reply_to?: ContactInfo[] | null;
};

const replyToFromHeadersJson = (
  headersJson: unknown
): ContactInfo[] => {
  if (!Array.isArray(headersJson)) return [];
  for (const header of headersJson) {
    if (!header || typeof header !== 'object') continue;
    const name = (header as { name?: unknown }).name;
    const value = (header as { value?: unknown }).value;
    if (typeof name !== 'string' || typeof value !== 'string') continue;
    if (name.toLowerCase() !== 'reply-to') continue;
    return parseAddressList(value);
  }
  return [];
};

/**
 * Usable Reply-To contacts for reply recipient selection.
 * Prefers first-class `reply_to` on the message; falls back to headers_json.
 */
export const getUsableReplyToContacts = (
  message: ApiMessage
): ContactInfo[] => {
  const withReplyTo = message as ApiMessageWithReplyTo;
  if (Array.isArray(withReplyTo.reply_to) && withReplyTo.reply_to.length > 0) {
    const filtered = withReplyTo.reply_to.filter(isUsableContactEmail);
    // Only treat first-class reply_to as authoritative when it yields usable
    // contacts; otherwise fall through to headers_json Reply-To.
    if (filtered.length > 0) return filtered;
  }
  return replyToFromHeadersJson(message.headers_json);
};

const excludeEmails = (
  recipients: ContactInfo[],
  ...emails: string[]
): ContactInfo[] => {
  const excluded = new Set(emails);
  return recipients.filter((recipient) => !excluded.has(recipient.email));
};

const dedupeByEmail = (recipients: ContactInfo[]): ContactInfo[] => {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    if (seen.has(recipient.email)) return false;
    seen.add(recipient.email);
    return true;
  });
};

// Note: because of the logic, this works with a reference message that is either the message being replied to, or the draft.
export const getReplyAllRecipients = (
  referenceMessage: ApiMessage | undefined,
  userEmail: string
): {
  to: EmailRecipient[];
  cc: EmailRecipient[];
  bcc: EmailRecipient[];
} => {
  let to: EmailRecipient[] = [];
  let cc: EmailRecipient[] = [];
  if (!referenceMessage) return { to, cc, bcc: [] };

  // If last message was from user - reply to the to recipients (cc is handled separately below)
  if (referenceMessage?.from?.email === userEmail) {
    if (referenceMessage.to && referenceMessage.to.length > 0) {
      to = referenceMessage.to.map(recipientEntityMapper('contact'));
    }
    // Otherwise keep existing recipients
  } else {
    const replyTo = excludeEmails(
      getUsableReplyToContacts(referenceMessage),
      userEmail
    );
    if (replyTo.length > 0) {
      // Reply-All with usable Reply-To: To = Reply-To; Cc = parent To+Cc
      // minus user and minus addresses already in To. From is not added to To.
      to = replyTo.map(convertContactInfoToEmailRecipient);
      const toEmails = replyTo.map((c) => c.email);
      const ccContacts = dedupeByEmail(
        excludeEmails(
          [...referenceMessage.to, ...referenceMessage.cc],
          userEmail,
          ...toEmails
        )
      );
      cc = ccContacts.map(convertContactInfoToEmailRecipient);
      return { to, cc, bcc: [] };
    }

    // Last message was NOT the user - reply to the sender
    // We need to include in the TO field both the sender of the last message, and the other recipients of the message we are replying to, NOT including the user.
    const sender: ContactInfo = referenceMessage.from ?? {
      email: '',
    };
    const otherRecipients = excludeEmails(
      referenceMessage.to,
      userEmail,
      sender.email
    );
    to = [sender, ...otherRecipients].map(convertContactInfoToEmailRecipient);
  }
  if (
    referenceMessage.cc &&
    excludeEmails(referenceMessage.cc, userEmail).length > 0
  ) {
    cc = excludeEmails(referenceMessage.cc, userEmail).map(
      convertContactInfoToEmailRecipient
    );
  }
  return { to, cc, bcc: [] };
};

// Whether Reply-all is meaningfully different from Reply for this message.
// Hidden when the user sent the message (Reply == Reply-all per
// getReplyRecipientsFromParent), or when no recipient remains in to/cc
// after filtering out both the user and the sender.
export const isReplyAllEligible = (
  message: ApiMessage,
  userEmail: string
): boolean => {
  const sender = message.from?.email;
  if (sender === userEmail) return false;
  const isOther = (email: string) => email !== userEmail && email !== sender;
  const otherTo = message.to.filter((r) => isOther(r.email));
  const otherCc = message.cc.filter((r) => isOther(r.email));
  return otherTo.length + otherCc.length > 0;
};

export const getReplyRecipientsFromParent = (
  replyingTo: ApiMessage | undefined,
  userEmail: string
): {
  to: EmailRecipient[];
  cc: EmailRecipient[];
  bcc: EmailRecipient[];
} => {
  if (!replyingTo) return { to: [], cc: [], bcc: [] };
  // If last message was from user, reply === replyAll
  if (replyingTo?.from?.email === userEmail) {
    return getReplyAllRecipients(replyingTo, userEmail);
  }

  const replyTo = getUsableReplyToContacts(replyingTo);
  if (replyTo.length > 0) {
    return {
      to: replyTo.map(convertContactInfoToEmailRecipient),
      cc: [],
      bcc: [],
    };
  }

  // Last message was NOT the user - reply to the sender
  const sender: ContactInfo = replyingTo.from ?? { email: '' };
  return {
    to: [convertContactInfoToEmailRecipient(sender)],
    cc: [],
    bcc: [],
  };
};
