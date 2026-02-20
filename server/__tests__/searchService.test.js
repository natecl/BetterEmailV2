const { groupAndRankResults } = require('../services/searchService');

// =========================================================
// groupAndRankResults
// =========================================================

describe('groupAndRankResults', () => {
    const baseRow = {
        vector_id: 1,
        message_id: 100,
        gmail_message_id: 'msg1',
        thread_id: 'thread1',
        subject: 'Test Subject',
        from_name: 'Alice',
        from_email: 'alice@test.com',
        labels: ['INBOX'],
        internal_date: '2024-06-15T10:00:00Z',
        chunk_type: 'chunk',
        chunk_text: 'Some relevant chunk text here.',
        similarity: 0.85
    };

    test('returns empty array for empty input', () => {
        expect(groupAndRankResults([])).toEqual([]);
    });

    test('returns empty array for null input', () => {
        expect(groupAndRankResults(null)).toEqual([]);
    });

    test('groups multiple vectors from same message', () => {
        const rows = [
            { ...baseRow, chunk_type: 'summary', similarity: 0.80, chunk_text: 'Summary text' },
            { ...baseRow, chunk_type: 'chunk', similarity: 0.85, chunk_text: 'Chunk text' }
        ];

        const results = groupAndRankResults(rows);
        expect(results).toHaveLength(1);
    });

    test('summary matches get 1.5x boost', () => {
        const rows = [
            {
                ...baseRow,
                gmail_message_id: 'msg1',
                chunk_type: 'summary',
                similarity: 0.60,
                chunk_text: 'Summary text'
            },
            {
                ...baseRow,
                gmail_message_id: 'msg2',
                chunk_type: 'chunk',
                similarity: 0.80,
                chunk_text: 'Chunk text'
            }
        ];

        const results = groupAndRankResults(rows);
        // msg1 summary: 0.60 * 1.5 = 0.90, msg2 chunk: 0.80
        // msg1 should be ranked first
        expect(results[0].gmail_message_id).toBe('msg1');
        expect(results[1].gmail_message_id).toBe('msg2');
    });

    test('sorts by score descending', () => {
        const rows = [
            { ...baseRow, gmail_message_id: 'low', similarity: 0.30 },
            { ...baseRow, gmail_message_id: 'high', similarity: 0.95 },
            { ...baseRow, gmail_message_id: 'mid', similarity: 0.60 }
        ];

        const results = groupAndRankResults(rows);
        expect(results.map(r => r.gmail_message_id)).toEqual(['high', 'mid', 'low']);
    });

    test('limits to top 10 results', () => {
        const rows = Array.from({ length: 20 }, (_, i) => ({
            ...baseRow,
            gmail_message_id: `msg${i}`,
            similarity: 0.5 + i * 0.02
        }));

        const results = groupAndRankResults(rows);
        expect(results).toHaveLength(10);
    });

    test('includes correct metadata fields', () => {
        const results = groupAndRankResults([baseRow]);

        expect(results[0]).toHaveProperty('gmail_message_id', 'msg1');
        expect(results[0]).toHaveProperty('thread_id', 'thread1');
        expect(results[0]).toHaveProperty('subject', 'Test Subject');
        expect(results[0]).toHaveProperty('from_name', 'Alice');
        expect(results[0]).toHaveProperty('from_email', 'alice@test.com');
        expect(results[0]).toHaveProperty('labels');
        expect(results[0]).toHaveProperty('internal_date');
        expect(results[0]).toHaveProperty('score');
        expect(results[0]).toHaveProperty('snippet');
    });

    test('does not leak sensitive fields (body_hash, body_text, embedding)', () => {
        const rows = [{
            ...baseRow,
            body_hash: 'secret-hash',
            body_text: 'full body text',
            embedding: [0.1, 0.2]
        }];

        const results = groupAndRankResults(rows);
        const serialized = JSON.stringify(results);
        expect(serialized).not.toContain('secret-hash');
        expect(serialized).not.toContain('full body text');
        expect(serialized).not.toContain('0.1,0.2');
    });

    test('truncates snippet to 200 chars', () => {
        const rows = [{
            ...baseRow,
            chunk_text: 'A'.repeat(500)
        }];

        const results = groupAndRankResults(rows);
        expect(results[0].snippet.length).toBeLessThanOrEqual(200);
    });

    test('picks highest-scoring chunk per message', () => {
        const rows = [
            { ...baseRow, chunk_type: 'chunk', similarity: 0.50, chunk_text: 'Low match' },
            { ...baseRow, chunk_type: 'chunk', similarity: 0.90, chunk_text: 'High match' }
        ];

        const results = groupAndRankResults(rows);
        expect(results[0].snippet).toContain('High match');
    });
});
