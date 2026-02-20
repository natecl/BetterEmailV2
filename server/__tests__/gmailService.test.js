const {
    extractBodyText,
    stripHtml,
    cleanBodyText,
    computeBodyHash,
    getHeader,
    parseFrom,
    upsertMessage
} = require('../services/gmailService');

// =========================================================
// extractBodyText
// =========================================================

describe('extractBodyText', () => {
    test('extracts plain text from simple body', () => {
        const payload = {
            mimeType: 'text/plain',
            body: { data: Buffer.from('Hello world').toString('base64url') }
        };
        expect(extractBodyText(payload)).toBe('Hello world');
    });

    test('extracts plain text from multipart payload', () => {
        const payload = {
            mimeType: 'multipart/alternative',
            parts: [
                {
                    mimeType: 'text/plain',
                    body: { data: Buffer.from('Plain text version').toString('base64url') }
                },
                {
                    mimeType: 'text/html',
                    body: { data: Buffer.from('<p>HTML version</p>').toString('base64url') }
                }
            ]
        };
        expect(extractBodyText(payload)).toBe('Plain text version');
    });

    test('falls back to HTML stripping when no plain text', () => {
        const payload = {
            mimeType: 'multipart/alternative',
            parts: [
                {
                    mimeType: 'text/html',
                    body: { data: Buffer.from('<p>Only HTML</p>').toString('base64url') }
                }
            ]
        };
        expect(extractBodyText(payload)).toBe('Only HTML');
    });

    test('returns empty string for null payload', () => {
        expect(extractBodyText(null)).toBe('');
    });

    test('returns empty string for payload with no body or parts', () => {
        expect(extractBodyText({ mimeType: 'text/plain' })).toBe('');
    });

    test('handles nested multipart', () => {
        const payload = {
            mimeType: 'multipart/mixed',
            parts: [
                {
                    mimeType: 'multipart/alternative',
                    parts: [
                        {
                            mimeType: 'text/plain',
                            body: { data: Buffer.from('Nested plain text').toString('base64url') }
                        }
                    ]
                }
            ]
        };
        expect(extractBodyText(payload)).toBe('Nested plain text');
    });
});


// =========================================================
// stripHtml
// =========================================================

describe('stripHtml', () => {
    test('removes HTML tags', () => {
        expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
    });

    test('removes style blocks', () => {
        expect(stripHtml('<style>.foo{color:red}</style><p>Text</p>')).toBe('Text');
    });

    test('removes script blocks', () => {
        expect(stripHtml('<script>alert("xss")</script><p>Safe</p>')).toBe('Safe');
    });

    test('decodes HTML entities', () => {
        expect(stripHtml('&amp; &lt; &gt; &quot; &#39;')).toBe("& < > \" '");
    });

    test('returns empty string for null', () => {
        expect(stripHtml(null)).toBe('');
    });

    test('collapses whitespace', () => {
        expect(stripHtml('<p>Hello</p>   <p>World</p>')).toBe('Hello World');
    });
});


// =========================================================
// cleanBodyText
// =========================================================

describe('cleanBodyText', () => {
    test('removes quoted replies', () => {
        const text = 'My reply here.\n\nOn Mon, Jan 1, 2024, Someone wrote:\n> Original text';
        expect(cleanBodyText(text)).toBe('My reply here.');
    });

    test('removes signature blocks', () => {
        const text = 'Main content\n-- \nJohn Doe\nCEO, Company';
        expect(cleanBodyText(text)).toBe('Main content');
    });

    test('removes forwarded headers', () => {
        const text = 'FYI see below.\n---------- Forwarded message ----------\nFrom: someone@test.com';
        expect(cleanBodyText(text)).toBe('FYI see below.');
    });

    test('returns empty string for null', () => {
        expect(cleanBodyText(null)).toBe('');
    });

    test('returns empty string for empty input', () => {
        expect(cleanBodyText('')).toBe('');
    });

    test('collapses excessive newlines', () => {
        const text = 'Line 1\n\n\n\n\nLine 2';
        expect(cleanBodyText(text)).toBe('Line 1\n\nLine 2');
    });
});


// =========================================================
// computeBodyHash
// =========================================================

describe('computeBodyHash', () => {
    test('returns 64-char hex string', () => {
        const hash = computeBodyHash('test content');
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('same input produces same hash', () => {
        const a = computeBodyHash('hello');
        const b = computeBodyHash('hello');
        expect(a).toBe(b);
    });

    test('different input produces different hash', () => {
        const a = computeBodyHash('hello');
        const b = computeBodyHash('world');
        expect(a).not.toBe(b);
    });

    test('returns null for null input', () => {
        expect(computeBodyHash(null)).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(computeBodyHash('')).toBeNull();
    });
});


// =========================================================
// getHeader
// =========================================================

describe('getHeader', () => {
    const headers = [
        { name: 'Subject', value: 'Test Email' },
        { name: 'From', value: 'sender@test.com' },
        { name: 'X-Custom', value: 'custom-value' }
    ];

    test('finds header case-insensitively', () => {
        expect(getHeader(headers, 'subject')).toBe('Test Email');
        expect(getHeader(headers, 'SUBJECT')).toBe('Test Email');
        expect(getHeader(headers, 'Subject')).toBe('Test Email');
    });

    test('returns null for missing header', () => {
        expect(getHeader(headers, 'To')).toBeNull();
    });

    test('returns null for null headers', () => {
        expect(getHeader(null, 'Subject')).toBeNull();
    });

    test('returns null for non-array headers', () => {
        expect(getHeader('not-array', 'Subject')).toBeNull();
    });
});


// =========================================================
// parseFrom
// =========================================================

describe('parseFrom', () => {
    test('parses "Name <email>" format', () => {
        const result = parseFrom('John Doe <john@test.com>');
        expect(result).toEqual({ name: 'John Doe', email: 'john@test.com' });
    });

    test('parses quoted name', () => {
        const result = parseFrom('"Jane Smith" <jane@test.com>');
        expect(result).toEqual({ name: 'Jane Smith', email: 'jane@test.com' });
    });

    test('parses bare email', () => {
        const result = parseFrom('bare@test.com');
        expect(result).toEqual({ name: '', email: 'bare@test.com' });
    });

    test('returns empty for null', () => {
        expect(parseFrom(null)).toEqual({ name: '', email: '' });
    });

    test('handles name without email', () => {
        const result = parseFrom('Just A Name');
        expect(result).toEqual({ name: 'Just A Name', email: '' });
    });
});


// =========================================================
// upsertMessage
// =========================================================

describe('upsertMessage', () => {
    function mockSupabase(existingRow, upsertResult) {
        const selectChain = {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
                data: existingRow,
                error: existingRow ? null : { code: 'PGRST116' }
            })
        };

        const upsertChain = {
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
                data: upsertResult || { id: 42 },
                error: null
            })
        };

        const insertMock = jest.fn().mockResolvedValue({ error: null });

        return {
            from: jest.fn().mockImplementation((table) => {
                if (table === 'gmail_messages') {
                    return {
                        ...selectChain,
                        upsert: jest.fn().mockReturnValue(upsertChain)
                    };
                }
                if (table === 'indexing_jobs') {
                    return { insert: insertMock };
                }
                return selectChain;
            }),
            _insertMock: insertMock
        };
    }

    const baseMsgData = {
        gmailMessageId: 'msg123',
        threadId: 'thread1',
        subject: 'Test',
        fromName: 'Sender',
        fromEmail: 'sender@test.com',
        toEmails: ['recipient@test.com'],
        labels: ['INBOX'],
        internalDate: '2024-01-01T00:00:00Z',
        bodyText: 'Hello',
        bodyHash: 'abc123'
    };

    test('returns "new" for new message and queues indexing job', async () => {
        const supabase = mockSupabase(null, { id: 42 });

        const result = await upsertMessage(supabase, 'user-1', baseMsgData);

        expect(result).toBe('new');
        expect(supabase._insertMock).toHaveBeenCalledWith(expect.objectContaining({
            message_id: 42,
            user_id: 'user-1',
            status: 'pending'
        }));
    });

    test('returns "unchanged" when body_hash matches', async () => {
        const supabase = mockSupabase({ id: 42, body_hash: 'abc123' });

        const result = await upsertMessage(supabase, 'user-1', baseMsgData);

        expect(result).toBe('unchanged');
        // Should not insert indexing job
        expect(supabase._insertMock).not.toHaveBeenCalled();
    });

    test('returns "changed" when body_hash differs', async () => {
        const supabase = mockSupabase({ id: 42, body_hash: 'old-hash' }, { id: 42 });

        const result = await upsertMessage(supabase, 'user-1', baseMsgData);

        expect(result).toBe('changed');
        expect(supabase._insertMock).toHaveBeenCalled();
    });
});


// =========================================================
// Security
// =========================================================

describe('Security', () => {
    test('stripHtml removes script injection', () => {
        const result = stripHtml('<script>document.cookie</script><p>Safe</p>');
        expect(result).toBe('Safe');
        expect(result).not.toContain('script');
        expect(result).not.toContain('cookie');
    });

    test('extractBodyText handles malicious base64 payload safely', () => {
        const payload = {
            mimeType: 'text/html',
            body: {
                data: Buffer.from('<img onerror="alert(1)" src=x>Hello').toString('base64url')
            }
        };
        const result = extractBodyText(payload);
        expect(result).not.toContain('onerror');
        expect(result).toContain('Hello');
    });
});
