/**
 * Wingman V2 — Lead Finder & Personalized Email Drafting
 */


/* =========================================================
   LEAD FINDER — DRAFT PERSONALIZED EMAILS
========================================================= */

/**
 * Wait for a NEW compose dialog to appear in the DOM.
 * Compares against `knownDialogs` (a Set of existing dialog elements).
 */
function waitForNewComposeDialog(knownDialogs, timeoutMs = 6000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const poll = setInterval(() => {
            const all = document.querySelectorAll('.nH.Hd[role="dialog"]');
            for (const el of all) {
                if (!knownDialogs.has(el)) {
                    clearInterval(poll);
                    // Small settle delay so Gmail finishes rendering the fields
                    setTimeout(() => resolve(el), 400);
                    return;
                }
            }
            if (Date.now() - start > timeoutMs) {
                clearInterval(poll);
                resolve(null);
            }
        }, 100);
    });
}

/**
 * Open Gmail's compose window and populate To, Subject, and Body fields.
 */
async function openGmailComposeDraft(draft) {
    // Snapshot existing compose dialogs before clicking Compose
    const before = new Set(document.querySelectorAll('.nH.Hd[role="dialog"]'));

    // Find and click Gmail's Compose button (try multiple known selectors)
    const composeSelectors = [
        '[data-tooltip="Compose"]',
        '.T-I.T-I-KE.L3',
        'div[gh="cm"]',
        '[aria-label="Compose"]'
    ];
    let composeBtn = null;
    for (const sel of composeSelectors) {
        composeBtn = document.querySelector(sel);
        if (composeBtn) break;
    }

    if (!composeBtn) {
        console.warn('[Wingman] Could not find Gmail Compose button');
        return false;
    }

    composeBtn.click();

    // Wait for the new compose dialog
    const dialog = await waitForNewComposeDialog(before);
    if (!dialog) {
        console.warn('[Wingman] Compose dialog did not open in time');
        return false;
    }

    // Fill "To" field — Gmail uses a special tokenized input
    const toInput = dialog.querySelector('input[name="to"], textarea[name="to"], [data-hm="to"] input, .agP.aFw');
    if (toInput) {
        toInput.focus();
        toInput.value = draft.email;
        toInput.dispatchEvent(new Event('input', { bubbles: true }));
        toInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        toInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    }

    // Fill Subject field
    const subjectInput = dialog.querySelector('input[name="subjectbox"]');
    if (subjectInput) {
        subjectInput.focus();
        subjectInput.value = draft.subject;
        subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Fill Body field (contenteditable div)
    const bodyEditor = dialog.querySelector('div[role="textbox"][contenteditable="true"]');
    if (bodyEditor) {
        bodyEditor.focus();
        bodyEditor.textContent = draft.body;
        bodyEditor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }

    return true;
}

/**
 * Call the server to draft personalized emails for up to 3 leads,
 * then open a Gmail compose window for each one.
 */
async function handleDraftLeadEmails(leads, btn) {
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="wm-sidebar-spinner"></div><span>Drafting with AI…</span>';

    try {
        const token = await getContentAccessToken();
        if (!token) {
            alert('Please sign in first.');
            return;
        }

        const res = await apiFetch(`${getApiBase()}/draft-personalized-emails`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ leads })
        });

        if (!res.ok) {
            alert(res.data?.error || 'Failed to draft emails. Check that your resume is saved in Settings.');
            return;
        }

        const { drafts } = res.data;
        if (!drafts || drafts.length === 0) {
            alert('No drafts were generated.');
            return;
        }

        // Open a compose window for each draft sequentially
        for (const draft of drafts) {
            const opened = await openGmailComposeDraft(draft);
            if (!opened) {
                console.warn(`[Wingman] Could not open compose for ${draft.email}`);
            }
            // Brief pause between windows so Gmail doesn't get confused
            await new Promise(r => setTimeout(r, 600));
        }
    } catch (err) {
        console.error('[Wingman] Draft lead emails error:', err);
        alert('Failed to draft emails: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}


/* =========================================================
   PER-ROW DRAFT BUTTON — PURPOSE MODAL
========================================================= */

/**
 * Show a modal asking the user what the email's purpose is.
 * Returns a Promise that resolves with the purpose string, or null if cancelled.
 */
function showPurposeModal(lead) {
    return new Promise((resolve) => {
        document.querySelector('.wm-purpose-modal-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'wm-purpose-modal-overlay';
        overlay.innerHTML = `
            <div class="wm-purpose-modal">
                <div class="wm-purpose-modal-header">
                    <span>Draft email to <strong>${escapeHTML(lead.name || lead.email)}</strong></span>
                    <button class="wm-purpose-modal-close" aria-label="Close">×</button>
                </div>
                <p class="wm-purpose-modal-desc">What's the purpose of your email? Be specific — the AI will use this as the main focus.</p>
                <textarea class="wm-purpose-modal-input" placeholder="e.g. Interested in joining your lab as a research assistant for the summer..." rows="3"></textarea>
                <div class="wm-purpose-modal-actions">
                    <button class="wm-purpose-cancel-btn">Cancel</button>
                    <button class="wm-purpose-submit-btn">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                        </svg>
                        Draft Email
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const textarea = overlay.querySelector('.wm-purpose-modal-input');
        const submitBtn = overlay.querySelector('.wm-purpose-submit-btn');
        const cancelBtn = overlay.querySelector('.wm-purpose-cancel-btn');
        const closeBtn = overlay.querySelector('.wm-purpose-modal-close');

        function close(value) {
            overlay.remove();
            resolve(value);
        }

        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
        closeBtn.addEventListener('click', () => close(null));
        cancelBtn.addEventListener('click', () => close(null));
        submitBtn.addEventListener('click', () => close(textarea.value.trim() || null));
        textarea.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && e.ctrlKey) close(textarea.value.trim() || null);
        });
        setTimeout(() => textarea.focus(), 50);
    });
}

/**
 * Draft a single personalized email to one lead after asking the user for a purpose.
 */
async function handleSingleLeadDraft(lead, btn) {
    const purpose = await showPurposeModal(lead);
    if (!purpose) return; // user cancelled

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="wm-sidebar-spinner"></div>';

    try {
        const token = await getContentAccessToken();
        if (!token) { alert('Please sign in first.'); return; }

        const res = await apiFetch(`${getApiBase()}/draft-personalized-emails`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ leads: [lead], purpose })
        });

        if (!res.ok) {
            alert(res.data?.error || 'Failed to draft email. Check that your resume is saved in Settings.');
            return;
        }

        const { drafts } = res.data;
        if (!drafts || drafts.length === 0) { alert('No draft was generated.'); return; }

        await openGmailComposeDraft(drafts[0]);
    } catch (err) {
        console.error('[Wingman] Single lead draft error:', err);
        alert('Failed to draft email: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}


/* =========================================================
   LEAD FINDER (sidebar)
========================================================= */

function wireLeadFinder(sidebar) {
    const input = sidebar.querySelector('#wm-sidebar-lead-input');
    const btn = sidebar.querySelector('#wm-sidebar-lead-btn');
    const statusEl = sidebar.querySelector('#wm-sidebar-lead-status');
    const resultsEl = sidebar.querySelector('#wm-sidebar-lead-results');

    async function handleSubmit() {
        const prompt = input.value.trim();
        if (!prompt) {
            statusEl.className = 'wm-sidebar-lead-status wm-status-error';
            statusEl.textContent = 'Please enter a search goal.';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<div class="wm-sidebar-spinner"></div><span>Searching...</span>';
        resultsEl.innerHTML = '';
        statusEl.className = 'wm-sidebar-lead-status wm-status-loading';
        statusEl.textContent = 'Checking cache...';

        try {
            const token = await getContentAccessToken();
            if (!token) {
                statusEl.className = 'wm-sidebar-lead-status wm-status-error';
                statusEl.textContent = 'Please sign in first.';
                return;
            }

            const res = await apiFetch(`${getApiBase()}/scrape-emails`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ prompt })
            });

            if (!res.ok) {
                statusEl.className = 'wm-sidebar-lead-status wm-status-error';
                statusEl.textContent = res.data.error || 'Search failed.';
                return;
            }

            const results = res.data.results || [];
            const source = res.data.source || 'unknown';

            if (results.length === 0) {
                statusEl.className = 'wm-sidebar-lead-status wm-status-error';
                statusEl.textContent = 'No results found. Try a different search.';
                return;
            }

            const sourceLabel = source === 'cache' ? 'From cache' :
                source === 'leads_cache' ? 'From saved leads' : 'Live results';
            statusEl.className = 'wm-sidebar-lead-status wm-status-success';
            statusEl.textContent = `${sourceLabel} — ${results.length} contact${results.length !== 1 ? 's' : ''} found`;

            let html = '<table class="wm-sidebar-lead-table">';
            html += '<thead><tr><th>Name</th><th>Email</th><th>Details</th></tr></thead>';
            html += '<tbody>';
            results.forEach(r => {
                html += `<tr>
                    <td class="wm-lead-name-cell">
                        <span class="wm-lead-name-text">${escapeHTML(r.name || 'Unknown')}</span>
                        <button class="wm-lead-row-draft-btn"
                            data-email="${escapeHTML(r.email)}"
                            data-name="${escapeHTML(r.name || '')}"
                            data-detail="${escapeHTML(r.detail || '')}"
                            data-sourceurl="${escapeHTML(r.sourceUrl || '')}"
                            title="Draft a personalized email to ${escapeHTML(r.name || r.email)}">
                            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                            </svg>
                            Draft
                        </button>
                    </td>
                    <td><a href="mailto:${escapeHTML(r.email)}">${escapeHTML(r.email)}</a></td>
                    <td>${escapeHTML(r.detail || '')}</td>
                </tr>`;
            });
            html += '</tbody></table>';
            resultsEl.innerHTML = html;

            // Wire per-row draft buttons
            resultsEl.querySelectorAll('.wm-lead-row-draft-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleSingleLeadDraft({
                        email: btn.dataset.email,
                        name: btn.dataset.name,
                        detail: btn.dataset.detail,
                        sourceUrl: btn.dataset.sourceurl
                    }, btn);
                });
            });

            // Add "Draft emails to top 3" button below the table
            if (results.length > 0) {
                const draftCount = Math.min(results.length, 3);
                const draftBtn = document.createElement('button');
                draftBtn.className = 'wm-leads-draft-btn';
                draftBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                    Draft emails to top ${draftCount}
                `;
                draftBtn.addEventListener('click', () => handleDraftLeadEmails(results.slice(0, 3), draftBtn));
                resultsEl.appendChild(draftBtn);
            }
        } catch (err) {
            console.error('[BetterEmail] Lead finder error:', err);
            statusEl.className = 'wm-sidebar-lead-status wm-status-error';
            statusEl.textContent = "Can't reach server. Is the backend running?";
        } finally {
            btn.disabled = false;
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Find Leads
            `;
        }
    }

    btn.addEventListener('click', handleSubmit);
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') handleSubmit();
    });
}
