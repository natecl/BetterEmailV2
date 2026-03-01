/**
 * Wingman V2 — Init (entry point)
 * Loaded last so all functions from other modules are available.
 */


/* =========================================================
   INIT
========================================================= */

function init() {
    console.log("[Wingman] Initializing sidebar...");

    // Inject the sidebar
    injectSidebar();

    // Check every second for compose windows
    setInterval(scanForComposeWindows, 1000);

    // Also watch for DOM changes
    const observer = new MutationObserver(scanForComposeWindows);
    observer.observe(document.body, { childList: true, subtree: true });

    // Safely enforce compose window offset mathematically against Gmail's engine
    observeComposeWindows();
}

if (document.body) {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}
