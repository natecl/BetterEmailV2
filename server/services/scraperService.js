const crypto = require('crypto');

/**
 * Normalize user prompt: lowercase, trim whitespace.
 * Extract a likely domain keyword from the prompt.
 */
function normalizePrompt(prompt) {
    const normalized = prompt.toLowerCase().trim().replace(/\s+/g, ' ');

    // Common university/org keyword → domain mapping
    const domainMap = {
        'uf': 'ufl.edu',
        'university of florida': 'ufl.edu',
        'mit': 'mit.edu',
        'stanford': 'stanford.edu',
        'harvard': 'harvard.edu',
        'berkeley': 'berkeley.edu',
        'uc berkeley': 'berkeley.edu',
        'ucla': 'ucla.edu',
        'georgia tech': 'gatech.edu',
        'carnegie mellon': 'cmu.edu',
        'cmu': 'cmu.edu',
        'columbia': 'columbia.edu',
        'yale': 'yale.edu',
        'princeton': 'princeton.edu',
        'cornell': 'cornell.edu',
        'nyu': 'nyu.edu',
        'umich': 'umich.edu',
        'university of michigan': 'umich.edu',
        'caltech': 'caltech.edu',
        'usf': 'usf.edu',
        'fsu': 'fsu.edu',
        'ucf': 'ucf.edu',
        'fiu': 'fiu.edu'
    };

    let domain = 'general';
    for (const [keyword, domainValue] of Object.entries(domainMap)) {
        if (normalized.includes(keyword)) {
            domain = domainValue;
            break;
        }
    }

    return { normalized, domain };
}

/**
 * Generate a SHA-256 cache key from domain and normalized prompt.
 */
function generateCacheKey(domain, normalizedPrompt) {
    const raw = `${domain}::${normalizedPrompt}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Check prompt_cache table for a fresh result (< 3 days old).
 * Returns array of email result objects or null.
 */
async function checkPromptCache(supabase, cacheKey) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('prompt_cache')
        .select('result_emails')
        .eq('cache_key', cacheKey)
        .gte('created_at', threeDaysAgo)
        .single();

    if (error || !data) return null;
    return data.result_emails;
}

/**
 * Check email_leads table for existing contacts in the given domain.
 * Returns array of lead objects or null.
 */
async function checkEmailLeads(supabase, domain) {
    if (domain === 'general') return null;

    const { data, error } = await supabase
        .from('email_leads')
        .select('email, name, title, source_urls')
        .eq('domain', domain)
        .limit(50);

    if (error || !data || data.length === 0) return null;

    return data.map(lead => ({
        name: lead.name || 'Unknown',
        email: lead.email,
        detail: lead.title || '',
        sourceUrl: lead.source_urls?.[0] || ''
    }));
}

/**
 * Use OpenAI web search to find candidate URLs for the given prompt.
 * Returns array of URL strings.
 */
async function searchForUrls(openai, prompt) {
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'system',
                content: 'You are a research assistant. Given a user query about finding contact information, return a JSON array of up to 20 relevant URLs that are likely to contain directories, faculty pages, or people listings. Return ONLY a JSON array of strings, no other text.'
            },
            {
                role: 'user',
                content: `Find web pages that would contain contact emails for: ${prompt}`
            }
        ],
        temperature: 0.3
    });

    const content = response.choices[0].message.content.trim();

    try {
        // Try to parse as JSON directly
        let urls = JSON.parse(content);
        if (Array.isArray(urls)) {
            return urls.filter(u => typeof u === 'string' && u.startsWith('http'));
        }
    } catch {
        // Try to extract URLs from text
        const urlRegex = /https?:\/\/[^\s"',\]]+/g;
        const matches = content.match(urlRegex);
        return matches || [];
    }

    return [];
}

/**
 * Use GPT-4o-mini to filter URLs down to the top 10 most likely
 * directory/people pages.
 */
async function filterUrls(openai, urls, prompt) {
    if (!urls || urls.length === 0) return [];
    if (urls.length <= 10) return urls;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'system',
                content: `You are a URL filter. Given a list of URLs and a search goal, select the top 10 URLs most likely to contain people directories, faculty listings, or contact pages with email addresses. Prefer:
1. University directory/people pages
2. Department faculty listings
3. Lab/research group pages
4. Staff directories
Return ONLY a JSON array of the selected URL strings, no other text.`
            },
            {
                role: 'user',
                content: `Goal: ${prompt}\n\nURLs to filter:\n${JSON.stringify(urls)}`
            }
        ],
        temperature: 0.1
    });

    const content = response.choices[0].message.content.trim();

    try {
        const filtered = JSON.parse(content);
        if (Array.isArray(filtered)) {
            return filtered.filter(u => typeof u === 'string' && u.startsWith('http')).slice(0, 10);
        }
    } catch {
        // Fall back to first 10 URLs
        return urls.slice(0, 10);
    }

    return urls.slice(0, 10);
}

/**
 * Use Firecrawl to scrape each URL and extract contact information.
 * Returns array of { name, email, detail, sourceUrl }.
 */
async function scrapeEmails(firecrawl, urls) {
    if (!urls || urls.length === 0) return [];

    const results = [];
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    for (const url of urls) {
        try {
            const scrapeResult = await firecrawl.scrapeUrl(url, {
                formats: ['markdown']
            });

            if (!scrapeResult.success || !scrapeResult.markdown) continue;

            const markdown = scrapeResult.markdown;
            const foundEmails = markdown.match(emailRegex) || [];

            // Deduplicate emails from this page
            const uniqueEmails = [...new Set(foundEmails)];

            for (const email of uniqueEmails) {
                // Skip common non-personal emails
                if (/^(info|contact|admin|support|webmaster|noreply|no-reply)@/i.test(email)) continue;

                // Try to extract name context around the email
                const emailIndex = markdown.indexOf(email);
                const surroundingText = markdown.substring(
                    Math.max(0, emailIndex - 200),
                    Math.min(markdown.length, emailIndex + 200)
                );

                // Attempt to find a name (line before email or nearby bold text)
                let name = 'Unknown';
                const namePatterns = [
                    /\*\*([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\*\*/,
                    /#+\s*([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/,
                    /([A-Z][a-z]+ (?:[A-Z]\. )?[A-Z][a-z]+)(?:,|\s*\n|\s*-|\s*\|)/
                ];

                for (const pattern of namePatterns) {
                    const nameMatch = surroundingText.match(pattern);
                    if (nameMatch) {
                        name = nameMatch[1].trim();
                        break;
                    }
                }

                // Try to extract a role/title
                let detail = '';
                const titlePatterns = [
                    /(?:Professor|Associate Professor|Assistant Professor|Lecturer|Director|Chair|Dean|Researcher|Postdoc|PhD)[^\n]*/i,
                    /(?:Department of|Dept\.? of)[^\n]*/i
                ];

                for (const pattern of titlePatterns) {
                    const titleMatch = surroundingText.match(pattern);
                    if (titleMatch) {
                        detail = titleMatch[0].trim().substring(0, 150);
                        break;
                    }
                }

                results.push({
                    name,
                    email,
                    detail,
                    sourceUrl: url
                });
            }
        } catch (err) {
            console.error(`Failed to scrape ${url}:`, err.message);
            // Continue with next URL
        }
    }

    // Deduplicate by email
    const seen = new Set();
    return results.filter(r => {
        if (seen.has(r.email)) return false;
        seen.add(r.email);
        return true;
    });
}

/**
 * Upsert scraped results into Supabase tables:
 * - scraped_pages: cache of what was scraped
 * - email_leads: directory of contacts
 * - prompt_cache: map prompt to results
 */
async function upsertResults(supabase, domain, normalizedPrompt, cacheKey, results, scrapedUrls) {
    // 1. Upsert scraped_pages
    for (const url of scrapedUrls) {
        const pageEmails = results.filter(r => r.sourceUrl === url);
        await supabase
            .from('scraped_pages')
            .upsert({
                url,
                domain,
                last_scraped_at: new Date().toISOString(),
                emails: pageEmails,
                text_snippet: `Scraped ${pageEmails.length} emails`
            }, { onConflict: 'url' });
    }

    // 2. Upsert email_leads
    for (const result of results) {
        await supabase
            .from('email_leads')
            .upsert({
                email: result.email,
                domain,
                name: result.name,
                title: result.detail,
                source_urls: [result.sourceUrl],
                last_seen_at: new Date().toISOString()
            }, { onConflict: 'email' });
    }

    // 3. Save to prompt_cache
    await supabase
        .from('prompt_cache')
        .upsert({
            cache_key: cacheKey,
            prompt: normalizedPrompt,
            domain,
            result_emails: results,
            created_at: new Date().toISOString()
        }, { onConflict: 'cache_key' });
}

module.exports = {
    normalizePrompt,
    generateCacheKey,
    checkPromptCache,
    checkEmailLeads,
    searchForUrls,
    filterUrls,
    scrapeEmails,
    upsertResults
};
