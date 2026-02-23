const request = require('supertest');

// --- Mocks ---

// Mock requireAuth middleware to inject a test user
jest.mock('../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.userId = 'test-user-id';
        req.userEmail = 'test@example.com';
        next();
    }
}));

// Mock Supabase createClient
jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn()
}));

// Mock pdf2json so we don't need real PDFs in unit tests.
// Uses globalThis to pass per-test data into the factory (avoids jest hoisting issues).
globalThis.__pdf2jsonMock = { text: '', shouldError: false };

jest.mock('pdf2json', () => {
    const EventEmitter = require('events').EventEmitter;
    return jest.fn().mockImplementation(() => {
        const emitter = new EventEmitter();
        emitter.parseBuffer = jest.fn().mockImplementation(() => {
            process.nextTick(() => {
                const mock = globalThis.__pdf2jsonMock;
                if (mock.shouldError) {
                    emitter.emit('pdfParser_dataError', { parserError: mock.error || 'parse error' });
                } else {
                    const pages = [{
                        Texts: [{ R: [{ T: encodeURIComponent(mock.text || '') }] }]
                    }];
                    emitter.emit('pdfParser_dataReady', { Pages: pages });
                }
            });
        });
        return emitter;
    });
});

const { createClient } = require('@supabase/supabase-js');
const PDFParser = require('pdf2json');

// Mock global fetch for OpenRouter API calls
global.fetch = jest.fn();

// Set required env vars before loading the app
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.CLAUDE_API_KEY = 'test-claude-key';

const app = require('../index');


// --- Mock factory for Supabase ---

function mockSupabase({ resumeText = null, resumeSummary = null, fetchError = null, updateError = null } = {}) {
    const chainable = {
        select: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
            data: resumeText !== null ? { resume_text: resumeText, resume_summary: resumeSummary } : null,
            error: fetchError
        })
    };

    // For PUT endpoint: update().eq() resolves directly (no .single())
    // For upload endpoint: upsert() resolves directly
    if (updateError !== undefined) {
        chainable.update = jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: updateError })
        });
        chainable.upsert = jest.fn().mockResolvedValue({ error: updateError });
    }

    return {
        from: jest.fn().mockReturnValue(chainable)
    };
}


// =========================================================
// GET /user/resume
// =========================================================

describe('GET /user/resume', () => {
    test('returns empty string when no resume saved', async () => {
        createClient.mockReturnValue(mockSupabase({ resumeText: '' }));

        const res = await request(app)
            .get('/user/resume')
            .set('Authorization', 'Bearer test-token');

        expect(res.status).toBe(200);
        expect(res.body.resume_text).toBe('');
        expect(res.body.resume_summary).toBe('');
    });

    test('returns saved resume_text', async () => {
        createClient.mockReturnValue(mockSupabase({ resumeText: 'My name is John. I have 5 years of experience.' }));

        const res = await request(app)
            .get('/user/resume')
            .set('Authorization', 'Bearer test-token');

        expect(res.status).toBe(200);
        expect(res.body.resume_text).toBe('My name is John. I have 5 years of experience.');
        expect(res.body.resume_summary).toBe('');
    });

    test('returns saved resume_summary when present', async () => {
        createClient.mockReturnValue(mockSupabase({
            resumeText: 'My name is John.',
            resumeSummary: 'John is an experienced engineer with 5 years of experience.'
        }));

        const res = await request(app)
            .get('/user/resume')
            .set('Authorization', 'Bearer test-token');

        expect(res.status).toBe(200);
        expect(res.body.resume_summary).toBe('John is an experienced engineer with 5 years of experience.');
    });

    test('returns empty strings when user has no profile row yet (PGRST116)', async () => {
        createClient.mockReturnValue(mockSupabase({
            fetchError: { code: 'PGRST116', message: 'The result contains 0 rows' }
        }));

        const res = await request(app)
            .get('/user/resume')
            .set('Authorization', 'Bearer test-token');

        expect(res.status).toBe(200);
        expect(res.body.resume_text).toBe('');
        expect(res.body.resume_summary).toBe('');
    });

    test('returns 500 when Supabase errors', async () => {
        createClient.mockReturnValue(mockSupabase({ fetchError: { code: 'PGRST301', message: 'DB error' } }));

        const res = await request(app)
            .get('/user/resume')
            .set('Authorization', 'Bearer test-token');

        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
    });
});


// =========================================================
// PUT /user/resume
// =========================================================

describe('PUT /user/resume', () => {
    test('saves valid resume_text and returns success', async () => {
        createClient.mockReturnValue(mockSupabase({ updateError: null }));

        const res = await request(app)
            .put('/user/resume')
            .set('Authorization', 'Bearer test-token')
            .send({ resume_text: 'John Doe. Software Engineer. 5 years experience.' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('returns 400 when resume_text is not a string', async () => {
        const res = await request(app)
            .put('/user/resume')
            .set('Authorization', 'Bearer test-token')
            .send({ resume_text: 12345 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/string/);
    });

    test('returns 400 when resume exceeds 20,000 characters', async () => {
        const res = await request(app)
            .put('/user/resume')
            .set('Authorization', 'Bearer test-token')
            .send({ resume_text: 'x'.repeat(20001) });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/20,000/);
    });

    test('returns 500 when Supabase update fails', async () => {
        createClient.mockReturnValue(mockSupabase({ updateError: { message: 'DB error' } }));

        const res = await request(app)
            .put('/user/resume')
            .set('Authorization', 'Bearer test-token')
            .send({ resume_text: 'Valid resume text.' });

        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
    });

    test('accepts empty string (clears resume)', async () => {
        createClient.mockReturnValue(mockSupabase({ updateError: null }));

        const res = await request(app)
            .put('/user/resume')
            .set('Authorization', 'Bearer test-token')
            .send({ resume_text: '' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});


// =========================================================
// POST /draft-email
// =========================================================

describe('POST /draft-email', () => {
    test('returns 400 when jobDescription is missing', async () => {
        const res = await request(app)
            .post('/draft-email')
            .set('Authorization', 'Bearer test-token')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/jobDescription/);
    });

    test('returns 400 when jobDescription is empty string', async () => {
        const res = await request(app)
            .post('/draft-email')
            .set('Authorization', 'Bearer test-token')
            .send({ jobDescription: '   ' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/jobDescription/);
    });

    test('returns 400 when jobDescription exceeds 2,000 characters', async () => {
        const res = await request(app)
            .post('/draft-email')
            .set('Authorization', 'Bearer test-token')
            .send({ jobDescription: 'x'.repeat(2001) });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/2,000/);
    });

    test('returns 400 when no resume is saved for the user', async () => {
        createClient.mockReturnValue(mockSupabase({ resumeText: null }));

        const res = await request(app)
            .post('/draft-email')
            .set('Authorization', 'Bearer test-token')
            .send({ jobDescription: 'Software Engineer at Google' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/resume/i);
    });

    test('returns draft when resume and jobDescription are both present', async () => {
        createClient.mockReturnValue(mockSupabase({ resumeText: 'John Doe, Software Engineer, 5 years React experience.' }));

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'I am writing to express my interest in the Software Engineer role...' } }]
            })
        });

        const res = await request(app)
            .post('/draft-email')
            .set('Authorization', 'Bearer test-token')
            .send({ jobDescription: 'Software Engineer at Google, React required' });

        expect(res.status).toBe(200);
        expect(res.body.draft).toBeDefined();
        expect(typeof res.body.draft).toBe('string');
        expect(res.body.draft.length).toBeGreaterThan(0);
    });

    test('returns error when AI API call fails', async () => {
        createClient.mockReturnValue(mockSupabase({ resumeText: 'John Doe resume text.' }));

        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: 'AI service unavailable' } })
        });

        const res = await request(app)
            .post('/draft-email')
            .set('Authorization', 'Bearer test-token')
            .send({ jobDescription: 'Software Engineer at Google' });

        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
    });

    test('does not leak resume text or API keys in error responses', async () => {
        createClient.mockReturnValue(mockSupabase({ resumeText: 'SECRET_RESUME_CONTENT' }));

        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: 'Internal error' } })
        });

        const res = await request(app)
            .post('/draft-email')
            .set('Authorization', 'Bearer test-token')
            .send({ jobDescription: 'Software Engineer' });

        const body = JSON.stringify(res.body);
        expect(body).not.toContain('SECRET_RESUME_CONTENT');
        expect(body).not.toContain('test-claude-key');
        expect(body).not.toContain('test-service-role-key');
    });
});


// =========================================================
// POST /user/resume/upload
// =========================================================

describe('POST /user/resume/upload', () => {
    const fakePdfBuffer = Buffer.from('%PDF-1.4 fake pdf content');

    beforeEach(() => {
        globalThis.__pdf2jsonMock = { text: '', shouldError: false };
        PDFParser.mockClear();
        global.fetch.mockClear();
    });

    test('returns 400 when no file is attached', async () => {
        const res = await request(app)
            .post('/user/resume/upload')
            .set('Authorization', 'Bearer test-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/No PDF/i);
    });

    test('returns 400 when uploaded file is not a PDF', async () => {
        const res = await request(app)
            .post('/user/resume/upload')
            .set('Authorization', 'Bearer test-token')
            .attach('resume', Buffer.from('plain text content'), {
                filename: 'resume.txt',
                contentType: 'text/plain'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Only PDF/i);
    });

    test('returns 400 when PDF parses to empty text', async () => {
        globalThis.__pdf2jsonMock = { text: '   ', shouldError: false };
        createClient.mockReturnValue(mockSupabase({ updateError: null }));

        const res = await request(app)
            .post('/user/resume/upload')
            .set('Authorization', 'Bearer test-token')
            .attach('resume', fakePdfBuffer, {
                filename: 'resume.pdf',
                contentType: 'application/pdf'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/empty/i);
    });

    test('returns 400 when extracted text exceeds 20,000 characters', async () => {
        globalThis.__pdf2jsonMock = { text: 'x'.repeat(20001), shouldError: false };
        createClient.mockReturnValue(mockSupabase({ updateError: null }));

        const res = await request(app)
            .post('/user/resume/upload')
            .set('Authorization', 'Bearer test-token')
            .attach('resume', fakePdfBuffer, {
                filename: 'resume.pdf',
                contentType: 'application/pdf'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/20,000/);
    });

    test('returns 400 when pdf2json throws (corrupt/image PDF)', async () => {
        globalThis.__pdf2jsonMock = { shouldError: true, error: 'Invalid PDF structure' };

        const res = await request(app)
            .post('/user/resume/upload')
            .set('Authorization', 'Bearer test-token')
            .attach('resume', fakePdfBuffer, {
                filename: 'resume.pdf',
                contentType: 'application/pdf'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/parse/i);
    });

    test('returns 500 when Supabase update fails after successful parse', async () => {
        globalThis.__pdf2jsonMock = { text: 'John Doe. Software Engineer.', shouldError: false };
        createClient.mockReturnValue(mockSupabase({ updateError: { message: 'DB error' } }));
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Test summary.' } }] })
        });

        const res = await request(app)
            .post('/user/resume/upload')
            .set('Authorization', 'Bearer test-token')
            .attach('resume', fakePdfBuffer, {
                filename: 'resume.pdf',
                contentType: 'application/pdf'
            });

        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
        expect(res.body.error).not.toContain('test-service-role-key');
    });

    test('happy path: valid PDF saves and returns character count and AI summary', async () => {
        const extractedText = 'John Doe Software Engineer 5 years of React experience.';
        globalThis.__pdf2jsonMock = { text: extractedText, shouldError: false };
        createClient.mockReturnValue(mockSupabase({ updateError: null }));
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'John is a skilled Software Engineer with 5 years of React experience.' } }]
            })
        });

        const res = await request(app)
            .post('/user/resume/upload')
            .set('Authorization', 'Bearer test-token')
            .attach('resume', fakePdfBuffer, {
                filename: 'resume.pdf',
                contentType: 'application/pdf'
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.characters).toBe(extractedText.trim().length);
        expect(typeof res.body.summary).toBe('string');
        expect(res.body.summary.length).toBeGreaterThan(0);
    });

    test('summary generation fails gracefully — upload still returns 200 with empty summary', async () => {
        const extractedText = 'Jane Smith. Product Manager. 3 years experience.';
        globalThis.__pdf2jsonMock = { text: extractedText, shouldError: false };
        createClient.mockReturnValue(mockSupabase({ updateError: null }));
        global.fetch.mockRejectedValueOnce(new Error('Network error'));

        const res = await request(app)
            .post('/user/resume/upload')
            .set('Authorization', 'Bearer test-token')
            .attach('resume', fakePdfBuffer, {
                filename: 'resume.pdf',
                contentType: 'application/pdf'
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.summary).toBe('');
    });

    test('summary API returns non-ok — upload still returns 200 with empty summary', async () => {
        const extractedText = 'Jane Smith. Product Manager. 3 years experience.';
        globalThis.__pdf2jsonMock = { text: extractedText, shouldError: false };
        createClient.mockReturnValue(mockSupabase({ updateError: null }));
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: 'AI service down' } })
        });

        const res = await request(app)
            .post('/user/resume/upload')
            .set('Authorization', 'Bearer test-token')
            .attach('resume', fakePdfBuffer, {
                filename: 'resume.pdf',
                contentType: 'application/pdf'
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.summary).toBe('');
    });
});
