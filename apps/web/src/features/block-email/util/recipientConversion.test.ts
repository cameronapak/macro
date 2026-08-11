/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import type { ApiMessage } from '@service-email/generated/schemas';
import {
  getReplyAllRecipients,
  getReplyRecipientsFromParent,
} from './recipientConversion';

const USER = 'me@macro.com';

function emailsOf(recipients: { data: { email: string } }[]): string[] {
  return recipients.map((r) => r.data.email);
}

function message(partial: {
  from?: { email: string; name?: string };
  to?: { email: string; name?: string }[];
  cc?: { email: string; name?: string }[];
  replyToHeader?: string | null;
  reply_to?: { email: string; name?: string }[];
}): ApiMessage {
  const headers_json =
    partial.replyToHeader === undefined
      ? undefined
      : partial.replyToHeader === null
        ? []
        : [{ name: 'Reply-To', value: partial.replyToHeader }];

  return {
    from: partial.from,
    to: partial.to ?? [],
    cc: partial.cc ?? [],
    bcc: [],
    headers_json,
    ...(partial.reply_to ? { reply_to: partial.reply_to } : {}),
  } as unknown as ApiMessage;
}

describe('getReplyRecipientsFromParent', () => {
  it('uses a usable single Reply-To as To and omits From', () => {
    const parent = message({
      from: { email: 'notifications@letterbird.co', name: 'Letterbird' },
      to: [{ email: USER }],
      replyToHeader: 'person@example.com',
    });

    const result = getReplyRecipientsFromParent(parent, USER);

    expect(emailsOf(result.to)).toEqual(['person@example.com']);
    expect(result.cc).toEqual([]);
    expect(result.bcc).toEqual([]);
  });

  it('puts every address from a multi-value Reply-To into To', () => {
    const parent = message({
      from: { email: 'notifications@letterbird.co' },
      to: [{ email: USER }],
      replyToHeader: 'Alice <alice@example.com>, bob@example.com',
    });

    const result = getReplyRecipientsFromParent(parent, USER);

    expect(emailsOf(result.to)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
    expect(result.cc).toEqual([]);
  });

  it('falls back to From when Reply-To is missing', () => {
    const parent = message({
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: USER }],
    });

    const result = getReplyRecipientsFromParent(parent, USER);

    expect(emailsOf(result.to)).toEqual(['sender@example.com']);
    expect(result.cc).toEqual([]);
  });

  it('falls back to From when Reply-To is unusable', () => {
    const parent = message({
      from: { email: 'sender@example.com' },
      to: [{ email: USER }],
      replyToHeader: '   , not-an-email, <>',
    });

    const result = getReplyRecipientsFromParent(parent, USER);

    expect(emailsOf(result.to)).toEqual(['sender@example.com']);
    expect(result.cc).toEqual([]);
  });
});

describe('getReplyAllRecipients', () => {
  it('uses Reply-To for To and puts other recipients in Cc, omitting From', () => {
    const parent = message({
      from: { email: 'notifications@letterbird.co' },
      to: [{ email: USER }, { email: 'teammate@example.com' }],
      cc: [{ email: 'cc@example.com' }],
      replyToHeader: 'person@example.com',
    });

    const result = getReplyAllRecipients(parent, USER);

    expect(emailsOf(result.to)).toEqual(['person@example.com']);
    expect(emailsOf(result.cc)).toEqual([
      'teammate@example.com',
      'cc@example.com',
    ]);
    expect(result.bcc).toEqual([]);
  });

  it('still excludes the user addresses from Reply-All recipients', () => {
    const parent = message({
      from: { email: 'notifications@letterbird.co' },
      to: [{ email: USER }, { email: 'other@example.com' }],
      cc: [{ email: USER }, { email: 'cc@example.com' }],
      replyToHeader: 'person@example.com',
    });

    const result = getReplyAllRecipients(parent, USER);

    expect(emailsOf(result.to)).toEqual(['person@example.com']);
    expect(emailsOf(result.cc)).toEqual([
      'other@example.com',
      'cc@example.com',
    ]);
    expect(emailsOf(result.to)).not.toContain(USER);
    expect(emailsOf(result.cc)).not.toContain(USER);
  });

  it('does not put Reply-To addresses into Cc again', () => {
    const parent = message({
      from: { email: 'notifications@letterbird.co' },
      to: [{ email: USER }, { email: 'person@example.com' }],
      cc: [{ email: 'cc@example.com' }],
      replyToHeader: 'person@example.com',
    });

    const result = getReplyAllRecipients(parent, USER);

    expect(emailsOf(result.to)).toEqual(['person@example.com']);
    expect(emailsOf(result.cc)).toEqual(['cc@example.com']);
  });
});
