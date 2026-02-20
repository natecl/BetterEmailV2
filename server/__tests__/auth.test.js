const { requireAuth } = require('../middleware/auth');

// Mock @supabase/supabase-js
jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn()
}));

const { createClient } = require('@supabase/supabase-js');

function mockReqResNext() {
    const req = { headers: {} };
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();
    return { req, res, next };
}

beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('requireAuth middleware', () => {

    // --- Missing token ---
    test('returns 401 when no Authorization header', async () => {
        const { req, res, next } = mockReqResNext();

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Missing or invalid authorization header' });
        expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when Authorization header is not Bearer', async () => {
        const { req, res, next } = mockReqResNext();
        req.headers.authorization = 'Basic abc123';

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    // --- Invalid token ---
    test('returns 401 when Supabase returns error', async () => {
        const { req, res, next } = mockReqResNext();
        req.headers.authorization = 'Bearer invalid-token';

        createClient.mockReturnValue({
            auth: {
                getUser: jest.fn().mockResolvedValue({
                    data: { user: null },
                    error: { message: 'Invalid token' }
                })
            }
        });

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
        expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when Supabase returns no user', async () => {
        const { req, res, next } = mockReqResNext();
        req.headers.authorization = 'Bearer some-token';

        createClient.mockReturnValue({
            auth: {
                getUser: jest.fn().mockResolvedValue({
                    data: { user: null },
                    error: null
                })
            }
        });

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    // --- Valid token ---
    test('calls next() and sets req.userId/req.userEmail on valid token', async () => {
        const { req, res, next } = mockReqResNext();
        req.headers.authorization = 'Bearer valid-token-123';

        const mockUser = {
            id: 'user-uuid-123',
            email: 'test@example.com'
        };

        createClient.mockReturnValue({
            auth: {
                getUser: jest.fn().mockResolvedValue({
                    data: { user: mockUser },
                    error: null
                })
            }
        });

        await requireAuth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.userId).toBe('user-uuid-123');
        expect(req.userEmail).toBe('test@example.com');
        expect(req.supabaseToken).toBe('valid-token-123');
        expect(res.status).not.toHaveBeenCalled();
    });

    // --- Exception handling ---
    test('returns 401 when createClient throws', async () => {
        const { req, res, next } = mockReqResNext();
        req.headers.authorization = 'Bearer crash-token';

        createClient.mockImplementation(() => {
            throw new Error('Connection failed');
        });

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Authentication failed' });
        expect(next).not.toHaveBeenCalled();
    });

    // --- Security: token not leaked ---
    test('does not leak token in error responses', async () => {
        const { req, res, next } = mockReqResNext();
        req.headers.authorization = 'Bearer secret-token-value';

        createClient.mockReturnValue({
            auth: {
                getUser: jest.fn().mockResolvedValue({
                    data: { user: null },
                    error: { message: 'expired' }
                })
            }
        });

        await requireAuth(req, res, next);

        const responseBody = res.json.mock.calls[0][0];
        expect(JSON.stringify(responseBody)).not.toContain('secret-token-value');
    });
});
