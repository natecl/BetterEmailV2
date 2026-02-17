/**
 * BetterEmail V2
 * Gmail Compose Analyzer - Inline Content Script
 */

console.log("[BetterEmail] Content script loaded");

const SYSTEM_PROMPT = `You are an expert email analyzer. The user will provide an email they have written and the context/purpose of the email.
Analyze the email and respond with a JSON array. Each element must have:
- "title"
- "icon"
- "content"
Return exactly these 5 sections in order:
1. Grammar & Spelling
2. Tone & Formality
3. Clarity & Structure
4. Suggestions
5. Overall Verdict
Return ONLY the JSON array.`;


/* =========================================================
   INIT
========================================================= */

function init() {
    console.log("[BetterEmail] Initializing...");
    
    // Check every second for compose windows
    setInterval(scanForComposeWindows, 1000);
    
    // Also watch for DOM changes
    const observer = new MutationObserver(scanForComposeWindows);
    observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}


/* =========================================================
   SCAN FOR COMPOSE WINDOWS
========================================================= */

function scanForComposeWindows() {
    // Look for ALL contenteditable divs that could be email editors
    const editors = document.querySelectorAll(
        '[aria-label="Message Body"], ' +
        '[g_editable="true"], ' +
        'div.editable[contenteditable="true"], ' +
        'div[contenteditable="true"][role="textbox"]'
    );
    
    editors.forEach(editor => {
        // Find the compose container (go up to find the form/dialog)
        const composeBox = editor.closest('div[role="dialog"]') || 
                          editor.closest('.M9') ||
                          editor.closest('form') ||
                          editor.closest('.nH.Hd');
        
        if (composeBox && !composeBox.dataset.beAttached) {
            console.log("[BetterEmail] Found compose window, attaching analyzer");
            attachAnalyzer(composeBox, editor);
        }
    });
}


/* =========================================================
   FIND EDITOR IN COMPOSE BOX
========================================================= */

function findEditorInCompose(composeBox) {
    const selectors = [
        '[aria-label="Message Body"]',
        '[aria-label="Body"]',
        '[g_editable="true"]',
        'div.editable[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div.Am.Al.editable',
        'div.aoI[contenteditable="true"]',
        'div[contenteditable="true"]'
    ];
    
    // First try within the compose box
    for (const selector of selectors) {
        const editor = composeBox.querySelector(selector);
        if (editor) {
            console.log("[BetterEmail] Found editor in composeBox with selector:", selector);
            return editor;
        }
    }
    
    // If not found, search globally (for cases where DOM structure is different)
    console.log("[BetterEmail] Editor not found in composeBox, searching globally...");
    for (const selector of selectors) {
        const editors = document.querySelectorAll(selector);
        for (const editor of editors) {
            // Make sure it's visible and has size
            const rect = editor.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 50) {
                console.log("[BetterEmail] Found visible editor globally with selector:", selector);
                return editor;
            }
        }
    }
    
    console.log("[BetterEmail] No editor found anywhere");
    return null;
}

function getEditorContent(editor) {
    // Log what we're working with
    console.log("[BetterEmail] Getting content from editor:", editor);
    console.log("[BetterEmail] Editor innerHTML preview:", editor.innerHTML?.substring(0, 200));
    
    // Try multiple ways to get content
    let content = "";
    
    // Method 1: innerText
    content = editor.innerText?.trim() || "";
    console.log("[BetterEmail] innerText result length:", content.length);
    if (content) return content;
    
    // Method 2: textContent
    content = editor.textContent?.trim() || "";
    console.log("[BetterEmail] textContent result length:", content.length);
    if (content) return content;
    
    // Method 3: innerHTML stripped of tags
    const temp = document.createElement("div");
    temp.innerHTML = editor.innerHTML || "";
    content = temp.textContent?.trim() || "";
    console.log("[BetterEmail] innerHTML->textContent result length:", content.length);
    
    return content;
}

function findAnyVisibleEditor() {
    const selectors = [
        '[aria-label="Message Body"]',
        '[aria-label="Body"]',
        '[g_editable="true"]',
        'div.editable[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div.Am.Al.editable',
        'div.aoI[contenteditable="true"]'
    ];
    
    for (const selector of selectors) {
        const editors = document.querySelectorAll(selector);
        for (const editor of editors) {
            const rect = editor.getBoundingClientRect();
            // Must be visible and reasonably sized
            if (rect.width > 100 && rect.height > 30 && rect.top > 0) {
                const content = editor.innerText?.trim() || editor.textContent?.trim() || "";
                if (content.length > 0) {
                    console.log("[BetterEmail] Found visible editor with content globally");
                    return editor;
                }
            }
        }
    }
    return null;
}


/* =========================================================
   ATTACH ANALYZER
========================================================= */

function attachAnalyzer(composeBox, initialEditor) {
    composeBox.dataset.beAttached = "true";
    
    // Store editor reference
    let storedEditor = initialEditor;
    
    // Create the analyzer bar
    const analyzer = document.createElement("div");
    analyzer.className = "be-inline-analyzer";
    analyzer.innerHTML = `
        <div class="be-analyzer-bar">
            <div class="be-bar-left">
                <div class="be-logo">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                    </svg>
                    <span>BetterEmail</span>
                </div>
            </div>
            <div class="be-bar-center">
                <input type="text" class="be-context-input" placeholder="What's this email for? (e.g., job application, follow-up)">
            </div>
            <div class="be-bar-right">
                <button type="button" class="be-analyze-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                    </svg>
                    <span>Analyze</span>
                </button>
            </div>
        </div>
        <div class="be-results-panel"></div>
    `;
    
    // Try to insert after the editor, or at the end of compose box
    const editorWrapper = initialEditor.closest('.Ar') || initialEditor.parentElement;
    if (editorWrapper && editorWrapper.parentElement) {
        editorWrapper.parentElement.insertBefore(analyzer, editorWrapper.nextSibling);
    } else {
        composeBox.appendChild(analyzer);
    }
    
    console.log("[BetterEmail] Analyzer bar injected");
    
    // Setup click handler
    const analyzeBtn = analyzer.querySelector(".be-analyze-btn");
    const contextInput = analyzer.querySelector(".be-context-input");
    const resultsPanel = analyzer.querySelector(".be-results-panel");
    
    // CRITICAL: Stop Gmail from capturing keyboard events on our input
    contextInput.addEventListener("keydown", (e) => e.stopPropagation());
    contextInput.addEventListener("keyup", (e) => e.stopPropagation());
    contextInput.addEventListener("keypress", (e) => e.stopPropagation());
    contextInput.addEventListener("focus", (e) => e.stopPropagation());
    contextInput.addEventListener("click", (e) => e.stopPropagation());
    
    analyzeBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Try stored editor first, then search for it
        let emailText = "";
        
        // Method 1: Use stored editor reference
        if (storedEditor && storedEditor.isConnected) {
            console.log("[BetterEmail] Using stored editor reference");
            emailText = getEditorContent(storedEditor);
        }
        
        // Method 2: Search within compose box
        if (!emailText) {
            console.log("[BetterEmail] Stored editor failed, searching in composeBox");
            const foundEditor = findEditorInCompose(composeBox);
            if (foundEditor) {
                storedEditor = foundEditor; // Update stored reference
                emailText = getEditorContent(foundEditor);
            }
        }
        
        // Method 3: Search globally for any visible editor
        if (!emailText) {
            console.log("[BetterEmail] Still no content, searching globally");
            const globalEditor = findAnyVisibleEditor();
            if (globalEditor) {
                storedEditor = globalEditor;
                emailText = getEditorContent(globalEditor);
            }
        }
        
        const context = contextInput.value.trim();
        
        console.log("[BetterEmail] Final email text length:", emailText.length);
        console.log("[BetterEmail] Context:", context);
        
        if (!emailText) {
            showError(resultsPanel, "Write your email first, then click Analyze.");
            return;
        }
        
        if (!context) {
            showError(resultsPanel, "Add context (e.g., 'job application') for better analysis.");
            return;
        }
        
        // Loading state
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<div class="be-spinner"></div><span>Analyzing...</span>';
        showLoading(resultsPanel);
        
        try {
            const res = await fetch("http://localhost:3000/analyze-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: emailText,
                    context,
                    systemPrompt: SYSTEM_PROMPT
                })
            });
            
            const data = await res.json();
            
            if (res.ok) {
                renderResults(resultsPanel, data.response);
            } else {
                showError(resultsPanel, data.error || "Analysis failed.");
            }
        } catch (err) {
            console.error("[BetterEmail] Error:", err);
            showError(resultsPanel, "Can't reach server. Is the backend running on localhost:3000?");
        }
        
        // Reset button
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
            </svg>
            <span>Analyze</span>
        `;
    });
}


/* =========================================================
   UI HELPERS
========================================================= */

function showLoading(panel) {
    panel.classList.add("visible");
    panel.innerHTML = `
        <div class="be-loading-state">
            <div class="be-loading-dots">
                <div class="be-dot"></div>
                <div class="be-dot"></div>
                <div class="be-dot"></div>
            </div>
            <span>Analyzing your email...</span>
        </div>
    `;
}

function showError(panel, message) {
    panel.classList.add("visible");
    panel.innerHTML = `
        <div class="be-error-state">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>${message}</span>
        </div>
    `;
}

function renderResults(panel, raw) {
    panel.classList.add("visible");
    panel.innerHTML = "";
    
    let jsonStr = raw.trim();
    if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    
    try {
        const sections = JSON.parse(jsonStr);
        
        const grid = document.createElement("div");
        grid.className = "be-results-grid";
        
        sections.forEach((s, i) => {
            const card = document.createElement("div");
            card.className = "be-result-card";
            card.style.animationDelay = `${i * 0.08}s`;
            
            // Color coding
            let accent = "";
            const title = s.title.toLowerCase();
            if (title.includes("grammar")) accent = "accent-blue";
            else if (title.includes("tone")) accent = "accent-purple";
            else if (title.includes("clarity")) accent = "accent-cyan";
            else if (title.includes("suggestion")) accent = "accent-yellow";
            else if (title.includes("verdict")) accent = "accent-green";
            
            if (accent) card.classList.add(accent);
            
            card.innerHTML = `
                <div class="be-card-header">
                    <span class="be-card-icon">${s.icon}</span>
                    <span class="be-card-title">${s.title}</span>
                </div>
                <div class="be-card-content">${s.content}</div>
            `;
            
            grid.appendChild(card);
        });
        
        // Close button
        const closeBtn = document.createElement("button");
        closeBtn.className = "be-close-results";
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Close
        `;
        closeBtn.addEventListener("click", () => {
            panel.classList.remove("visible");
            panel.innerHTML = "";
        });
        
        panel.appendChild(grid);
        panel.appendChild(closeBtn);
        
    } catch (e) {
        panel.innerHTML = `<div class="be-raw-result">${raw}</div>`;
    }
}
