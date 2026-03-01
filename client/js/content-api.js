/**
 * Wingman V2 — API Proxy & Auth Helpers
 * Loaded first so apiFetch/auth functions are available to all other modules.
 */

console.log("[Wingman] Content script loaded — v3.0 (Sidebar Copilot)");


/* =========================================================
   API PROXY — routes fetch calls through background service
   worker to avoid mixed-content (HTTPS→HTTP) and CORS issues
========================================================= */

function apiFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({
                type: "API_FETCH",
                url,
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body || undefined
            }, (response) => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message || '';
                    if (errMsg.includes('Extension context invalidated')) {
                        return reject(new Error('Extension was updated — please refresh this Gmail tab (Cmd+Shift+R)'));
                    }
                    return reject(new Error(errMsg));
                }
                if (!response) {
                    return reject(new Error('No response from background script'));
                }
                if (response.error) {
                    return reject(new Error(response.error));
                }
                resolve(response);
            });
        } catch (err) {
            if (err.message && err.message.includes('Extension context invalidated')) {
                reject(new Error('Extension was updated — please refresh this Gmail tab (Cmd+Shift+R)'));
            } else {
                reject(err);
            }
        }
    });
}


/* =========================================================
   AUTH HELPERS (content script context)
========================================================= */

async function isAuthenticated() {
    return new Promise((resolve) => {
        chrome.storage.local.get('wm_supabase_session', (result) => {
            const session = result.wm_supabase_session || null;
            resolve(!!(session && session.access_token));
        });
    });
}

function getApiBase() {
    return typeof WM_CONFIG !== 'undefined' ? WM_CONFIG.API_URL : 'http://localhost:3000';
}

async function getContentAccessToken() {
    return new Promise((resolve) => {
        chrome.storage.local.get('wm_supabase_session', (result) => {
            const session = result.wm_supabase_session || null;
            if (!session) return resolve(null);
            resolve(session.access_token || null);
        });
    });
}

async function getContentSession() {
    return new Promise((resolve) => {
        chrome.storage.local.get('wm_supabase_session', (result) => {
            resolve(result.wm_supabase_session || null);
        });
    });
}

// Listen for auth state changes and refresh sidebar
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wm_supabase_session) {
        console.log("[Wingman] Auth state changed, refreshing sidebar");
        refreshSidebarAuth();
    }
});
