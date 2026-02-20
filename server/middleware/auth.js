/**
 * BetterEmail V2 — Auth Middleware
 *
 * Validates Supabase JWT from Authorization: Bearer header.
 * Attaches req.userId and req.userEmail on success.
 */

const { createClient } = require('@supabase/supabase-js');

/**
 * Express middleware that requires a valid Supabase access token.
 * Returns 401 if missing/invalid.
 */
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7);

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            {
                global: {
                    headers: { Authorization: `Bearer ${token}` }
                }
            }
        );

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        req.userId = user.id;
        req.userEmail = user.email;
        req.supabaseToken = token;

        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        return res.status(401).json({ error: 'Authentication failed' });
    }
}

module.exports = { requireAuth };
