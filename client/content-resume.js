/**
 * Wingman V2 — Resume Upload (sidebar Settings tab)
 */


/* =========================================================
   RESUME UPLOAD (sidebar settings)
========================================================= */

function wireResumeUpload(sidebar) {
    const fileInput = sidebar.querySelector('#wm-sidebar-resume-file');
    const uploadZone = sidebar.querySelector('#wm-sidebar-upload-zone');
    const fileChosen = sidebar.querySelector('#wm-sidebar-file-chosen');
    const fileName = sidebar.querySelector('#wm-sidebar-file-name');
    const fileRemove = sidebar.querySelector('#wm-sidebar-file-remove');
    const saveBtn = sidebar.querySelector('#wm-sidebar-resume-save');
    const statusEl = sidebar.querySelector('#wm-sidebar-resume-status');

    sidebar.querySelector('#wm-sidebar-upload-browse').addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('wm-sidebar-upload-drag'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('wm-sidebar-upload-drag'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('wm-sidebar-upload-drag');
        const file = e.dataTransfer?.files?.[0];
        if (file) setResumeFile(file);
    });
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) setResumeFile(file);
    });

    function setResumeFile(file) {
        if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
            statusEl.textContent = 'Please select a PDF file.';
            statusEl.className = 'wm-sidebar-resume-status wm-status-err';
            return;
        }
        fileName.textContent = file.name;
        uploadZone.style.display = 'none';
        fileChosen.style.display = 'flex';
        saveBtn.disabled = false;
        statusEl.textContent = '';
        statusEl.className = 'wm-sidebar-resume-status';
    }

    fileRemove.addEventListener('click', () => {
        fileInput.value = '';
        uploadZone.style.display = 'flex';
        fileChosen.style.display = 'none';
        saveBtn.disabled = true;
        statusEl.textContent = '';
        statusEl.className = 'wm-sidebar-resume-status';
    });

    saveBtn.addEventListener('click', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        statusEl.textContent = 'Uploading...';
        statusEl.className = 'wm-sidebar-resume-status';
        saveBtn.disabled = true;

        try {
            const token = await getContentAccessToken();
            if (!token) {
                statusEl.textContent = 'Not signed in.';
                statusEl.className = 'wm-sidebar-resume-status wm-status-err';
                saveBtn.disabled = false;
                return;
            }

            // Read file as base64, send through background's FILE_UPLOAD proxy
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = reader.result.split(',')[1];
                try {
                    const res = await new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage({
                            type: "FILE_UPLOAD",
                            url: `${getApiBase()}/user/resume/upload`,
                            token,
                            fileData: base64,
                            fileName: file.name,
                            fileType: file.type,
                            fieldName: 'resume'
                        }, (response) => {
                            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                            if (!response) return reject(new Error('No response'));
                            resolve(response);
                        });
                    });

                    if (res.ok) {
                        statusEl.textContent = res.data.summary
                            ? `Resume uploaded! AI summary generated. (${res.data.characters?.toLocaleString() || '?'} chars)`
                            : `Resume saved. AI summary unavailable.`;
                        statusEl.className = 'wm-sidebar-resume-status wm-status-ok';
                        const t = await getContentAccessToken();
                        if (t) await loadSidebarResume(t);
                    } else {
                        statusEl.textContent = res.data?.error || 'Upload failed.';
                        statusEl.className = 'wm-sidebar-resume-status wm-status-err';
                    }
                } catch (err) {
                    statusEl.textContent = 'Could not reach server.';
                    statusEl.className = 'wm-sidebar-resume-status wm-status-err';
                }
                saveBtn.disabled = false;
            };
            reader.readAsDataURL(file);
        } catch (err) {
            statusEl.textContent = 'Could not reach server.';
            statusEl.className = 'wm-sidebar-resume-status wm-status-err';
            saveBtn.disabled = false;
        }
    });
}

async function loadSidebarResume(token) {
    try {
        const res = await apiFetch(`${getApiBase()}/user/resume`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = res.data;
            const indicator = document.getElementById('wm-sidebar-resume-on-file');
            const summary = document.getElementById('wm-sidebar-resume-summary');
            const summaryText = document.getElementById('wm-sidebar-summary-text');
            if (indicator) indicator.style.display = data.resume_text ? 'block' : 'none';
            if (data.resume_summary) {
                if (summaryText) summaryText.textContent = data.resume_summary;
                if (summary) summary.style.display = 'flex';
            } else {
                if (summary) summary.style.display = 'none';
            }
        }
    } catch (err) {
        console.error('[Wingman] Failed to load resume:', err);
    }
}
