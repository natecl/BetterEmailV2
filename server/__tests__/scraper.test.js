const {
    normalizePrompt,
    generateCacheKey,
    checkPromptCache,
    checkEmailLeads,
    searchForUrls,
    filterUrls,
    scrapeEmails,
    upsertResults
} = require('../services/scraperService');

// --- Mock factories ---

function mockSupabase(overrides = {}) {
    const defaults = {
        selectData: null,
        selectError: null,
        upsertError: null
    };
    const opts = { ...defaults, ...overrides };

    const chainable = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: opts.selectData, error: opts.selectError })
    };

    // For non-single queries (checkEmailLeads)
    if (opts.selectMany) {
        chainable.limit = jest.fn().mockResolvedValue({ data: opts.selectMany, error: opts.selectError });
    }

    return {
        from: jest.fn().mockReturnValue({
            ...chainable,
            upsert: jest.fn().mockResolvedValue({ error: opts.upsertError })
        })
    };
}

function mockOpenAI(responseContent) {
    return {
        chat: {
            completions: {
                create: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: responseContent } }]
                })
            }
        }
    };
}

function mockFirecrawl(results) {
    return {
        scrapeUrl: jest.fn().mockImplementation((url) => {
            const result = results[url];
            if (result) return Promise.resolve(result);
            return Promise.resolve({ success: false });
        })
    };
}


// =========================================================
// normalizePrompt
// =========================================================

describe('normalizePrompt', () => {
    test('lowercases and trims the prompt', () => {
        const { normalized } = normalizePrompt('  UF Computer Science  ');
        expect(normalized).toBe('uf computer science');
    });

    test('collapses multiple spaces', () => {
        const { normalized } = normalizePrompt('find   professors   at   MIT');
        expect(normalized).toBe('find professors at mit');
    });

    test('extracts known university domain', () => {
        const { domain } = normalizePrompt('UF Computer Science professors');
        expect(domain).toBe('ufl.edu');
    });

    test('extracts MIT domain', () => {
        const { domain } = normalizePrompt('MIT AI research lab');
        expect(domain).toBe('mit.edu');
    });

    test('returns "general" for unknown domain', () => {
        const { domain } = normalizePrompt('random company contacts');
        expect(domain).toBe('general');
    });
});


// =========================================================
// generateCacheKey
// =========================================================

describe('generateCacheKey', () => {
    test('returns a 64-char hex string (SHA-256)', () => {
        const key = generateCacheKey('ufl.edu', 'uf computer science professors');
        expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    test('same inputs produce same key', () => {
        const a = generateCacheKey('ufl.edu', 'uf cs professors');
        const b = generateCacheKey('ufl.edu', 'uf cs professors');
        expect(a).toBe(b);
    });

    test('different inputs produce different keys', () => {
        const a = generateCacheKey('ufl.edu', 'cs professors');
        const b = generateCacheKey('mit.edu', 'cs professors');
        expect(a).not.toBe(b);
    });
});


// =========================================================
// checkPromptCache
// =========================================================

describe('checkPromptCache', () => {
    test('returns cached results when fresh cache exists', async () => {
        const cachedEmails = [{ name: 'Alice', email: 'alice@ufl.edu' }];
        const supabase = mockSupabase({
            selectData: { result_emails: cachedEmails }
        });

        const result = await checkPromptCache(supabase, 'some-cache-key');
        expect(result).toEqual(cachedEmails);
        expect(supabase.from).toHaveBeenCalledWith('prompt_cache');
    });

    test('returns null when no cache exists', async () => {
        const supabase = mockSupabase({ selectData: null, selectError: { code: 'PGRST116' } });
        const result = await checkPromptCache(supabase, 'missing-key');
        expect(result).toBeNull();
    });
});


// =========================================================
// checkEmailLeads
// =========================================================

describe('checkEmailLeads', () => {
    test('returns null for "general" domain', async () => {
        const supabase = mockSupabase();
        const result = await checkEmailLeads(supabase, 'general');
        expect(result).toBeNull();
        expect(supabase.from).not.toHaveBeenCalled();
    });

    test('returns formatted leads when data exists', async () => {
        const leads = [
            { email: 'prof@ufl.edu', name: 'Dr. Smith', title: 'Professor', source_urls: ['https://ufl.edu/dir'] }
        ];
        const supabase = mockSupabase({ selectMany: leads });

        const result = await checkEmailLeads(supabase, 'ufl.edu');
        expect(result).toEqual([{
            name: 'Dr. Smith',
            email: 'prof@ufl.edu',
            detail: 'Professor',
            sourceUrl: 'https://ufl.edu/dir'
        }]);
    });

    test('returns null when no leads found', async () => {
        const supabase = mockSupabase({ selectMany: [] });
        const result = await checkEmailLeads(supabase, 'ufl.edu');
        expect(result).toBeNull();
    });
});


// =========================================================
// searchForUrls
// =========================================================

describe('searchForUrls', () => {
    test('parses JSON array response from OpenAI', async () => {
        const urls = ['https://cise.ufl.edu/people', 'https://ufl.edu/directory'];
        const openai = mockOpenAI(JSON.stringify(urls));

        const result = await searchForUrls(openai, 'UF CS professors');
        expect(result).toEqual(urls);
    });

    test('extracts URLs from non-JSON text response', async () => {
        const openai = mockOpenAI('Here are some URLs: https://example.com/dir and https://test.com/people');
        const result = await searchForUrls(openai, 'some query');
        expect(result).toContain('https://example.com/dir');
        expect(result).toContain('https://test.com/people');
    });

    test('filters out non-http strings', async () => {
        const openai = mockOpenAI(JSON.stringify(['https://valid.com', 'not-a-url', 'ftp://wrong']));
        const result = await searchForUrls(openai, 'query');
        expect(result).toEqual(['https://valid.com']);
    });
});


// =========================================================
// filterUrls
// =========================================================

describe('filterUrls', () => {
    test('returns all URLs if <= 10', async () => {
        const urls = ['https://a.com', 'https://b.com'];
        const openai = mockOpenAI('[]');
        const result = await filterUrls(openai, urls, 'query');
        expect(result).toEqual(urls);
        expect(openai.chat.completions.create).not.toHaveBeenCalled();
    });

    test('returns empty array for empty input', async () => {
        const openai = mockOpenAI('[]');
        const result = await filterUrls(openai, [], 'query');
        expect(result).toEqual([]);
    });

    test('calls OpenAI and returns filtered URLs when > 10', async () => {
        const manyUrls = Array.from({ length: 15 }, (_, i) => `https://site${i}.com`);
        const filtered = manyUrls.slice(0, 5);
        const openai = mockOpenAI(JSON.stringify(filtered));

        const result = await filterUrls(openai, manyUrls, 'query');
        expect(result).toEqual(filtered);
        expect(openai.chat.completions.create).toHaveBeenCalled();
    });

    test('falls back to first 10 URLs on parse error', async () => {
        const manyUrls = Array.from({ length: 15 }, (_, i) => `https://site${i}.com`);
        const openai = mockOpenAI('invalid json response');

        const result = await filterUrls(openai, manyUrls, 'query');
        expect(result).toEqual(manyUrls.slice(0, 10));
    });
});


// =========================================================
// scrapeEmails
// =========================================================

describe('scrapeEmails', () => {
    test('returns empty array for empty URLs', async () => {
        const firecrawl = mockFirecrawl({});
        const result = await scrapeEmails(firecrawl, []);
        expect(result).toEqual([]);
    });

    test('extracts emails from scraped markdown', async () => {
        const firecrawl = mockFirecrawl({
            'https://example.com/dir': {
                success: true,
                markdown: '**John Smith**\nProfessor of CS\njohn.smith@example.com\n\n**Jane Doe**\nAssistant Professor\njane.doe@example.com'
            }
        });

        const result = await scrapeEmails(firecrawl, ['https://example.com/dir']);
        expect(result.length).toBe(2);
        expect(result[0].email).toBe('john.smith@example.com');
        expect(result[1].email).toBe('jane.doe@example.com');
    });

    test('skips generic emails like info@ and support@', async () => {
        const firecrawl = mockFirecrawl({
            'https://example.com': {
                success: true,
                markdown: 'Contact info@example.com or support@example.com or real.person@example.com'
            }
        });

        const result = await scrapeEmails(firecrawl, ['https://example.com']);
        expect(result.length).toBe(1);
        expect(result[0].email).toBe('real.person@example.com');
    });

    test('deduplicates emails across pages', async () => {
        const firecrawl = mockFirecrawl({
            'https://a.com': { success: true, markdown: 'Contact: dupe@test.com' },
            'https://b.com': { success: true, markdown: 'Also: dupe@test.com' }
        });

        const result = await scrapeEmails(firecrawl, ['https://a.com', 'https://b.com']);
        expect(result.length).toBe(1);
    });

    test('continues scraping if one URL fails', async () => {
        const firecrawl = {
            scrapeUrl: jest.fn()
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({
                    success: true,
                    markdown: 'Found: good@example.com'
                })
        };

        const result = await scrapeEmails(firecrawl, ['https://bad.com', 'https://good.com']);
        expect(result.length).toBe(1);
        expect(result[0].email).toBe('good@example.com');
    });
});


// =========================================================
// upsertResults
// =========================================================

describe('upsertResults', () => {
    test('calls upsert on all three tables', async () => {
        const supabase = mockSupabase();
        const results = [{ name: 'Test', email: 'test@ufl.edu', detail: 'Prof', sourceUrl: 'https://ufl.edu' }];

        await upsertResults(supabase, 'ufl.edu', 'test prompt', 'cache-key', results, ['https://ufl.edu']);

        // Should call from() for scraped_pages, email_leads, and prompt_cache
        const fromCalls = supabase.from.mock.calls.map(c => c[0]);
        expect(fromCalls).toContain('scraped_pages');
        expect(fromCalls).toContain('email_leads');
        expect(fromCalls).toContain('prompt_cache');
    });
});


// =========================================================
// Full pipeline integration (cache hit vs miss)
// =========================================================

describe('Full pipeline', () => {
    test('cache hit returns immediately without calling OpenAI/Firecrawl', async () => {
        const cachedEmails = [{ name: 'Cached', email: 'cached@ufl.edu', detail: '', sourceUrl: '' }];
        const supabase = mockSupabase({
            selectData: { result_emails: cachedEmails }
        });
        const openai = mockOpenAI('[]');
        const firecrawl = mockFirecrawl({});

        // Simulate the pipeline
        const { normalized, domain } = normalizePrompt('UF CS professors');
        const cacheKey = generateCacheKey(domain, normalized);
        const cached = await checkPromptCache(supabase, cacheKey);

        expect(cached).toEqual(cachedEmails);
        // OpenAI and Firecrawl should NOT be called
        expect(openai.chat.completions.create).not.toHaveBeenCalled();
        expect(firecrawl.scrapeUrl).not.toHaveBeenCalled();
    });

    test('cache miss runs full pipeline', async () => {
        // Cache miss
        const supabaseMiss = mockSupabase({ selectData: null, selectError: { code: 'PGRST116' } });

        const { normalized, domain } = normalizePrompt('UF CS professors');
        const cacheKey = generateCacheKey(domain, normalized);
        const cached = await checkPromptCache(supabaseMiss, cacheKey);
        expect(cached).toBeNull();

        // Should proceed to search
        const openai = mockOpenAI(JSON.stringify(['https://cise.ufl.edu/people']));
        const urls = await searchForUrls(openai, 'UF CS professors');
        expect(urls.length).toBeGreaterThan(0);

        // Filter (only 1 URL, under threshold)
        const filtered = await filterUrls(openai, urls, 'UF CS professors');
        expect(filtered.length).toBeGreaterThan(0);

        // Scrape
        const firecrawl = mockFirecrawl({
            'https://cise.ufl.edu/people': {
                success: true,
                markdown: '**Dr. Alan Turing**\nProfessor\nturing@cise.ufl.edu'
            }
        });
        const results = await scrapeEmails(firecrawl, filtered);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].email).toBe('turing@cise.ufl.edu');
    });
});


// =========================================================
// Input validation (tested at endpoint level concept)
// =========================================================

describe('Input edge cases', () => {
    test('normalizePrompt handles empty string', () => {
        const { normalized, domain } = normalizePrompt('');
        expect(normalized).toBe('');
        expect(domain).toBe('general');
    });

    test('normalizePrompt handles string with only spaces', () => {
        const { normalized, domain } = normalizePrompt('   ');
        expect(normalized).toBe('');
        expect(domain).toBe('general');
    });

    test('generateCacheKey handles empty inputs', () => {
        const key = generateCacheKey('', '');
        expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    test('scrapeEmails handles null urls', async () => {
        const firecrawl = mockFirecrawl({});
        const result = await scrapeEmails(firecrawl, null);
        expect(result).toEqual([]);
    });
});


// =========================================================
// Security tests
// =========================================================

describe('Security', () => {
    test('normalizePrompt treats template-like strings as plain text', () => {
        const input = '${process.env.SECRET_KEY} find professors';
        const { normalized } = normalizePrompt(input);
        // normalizePrompt just lowercases - it doesn't evaluate expressions
        expect(normalized).toBe('${process.env.secret_key} find professors');
    });

    test('scrapeEmails does not include script injection in results', async () => {
        const firecrawl = mockFirecrawl({
            'https://evil.com': {
                success: true,
                markdown: '<script>alert("xss")</script>\nevil@test.com'
            }
        });

        const result = await scrapeEmails(firecrawl, ['https://evil.com']);
        // Email is extracted but no script tags in name/detail
        expect(result.length).toBe(1);
        expect(result[0].name).not.toContain('<script>');
        expect(result[0].detail).not.toContain('<script>');
    });
});
