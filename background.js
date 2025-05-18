// Track current tab URL and state
let currentTabState = new Map();

// Listen for tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only proceed if we have URL information
  if (!tab.url) return;
  
  // Check if the tab is on Twitter/X
  if ((tab.url.includes('x.com') || tab.url.includes('twitter.com'))) {
    // Update current URL in our state tracker
    currentTabState.set(tabId, {
      url: tab.url,
      isMessagesPage: tab.url.includes('/messages')
    });
    
    // Initialize extension on any Twitter/X URL when page is completely loaded
    if (changeInfo.status === 'complete') {
      // Give the page a moment to load DOM elements
      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          function: initializeArchiver
        });
      }, 1000); // 1-second delay to ensure page elements are loaded
    }
  }
});

// Function to initialize the archiver (runs in content script context)
function initializeArchiver() {
  // Run on any Twitter/X page
  if (window.location.hostname.includes('x.com') || 
      window.location.hostname.includes('twitter.com')) {
    if (typeof window.addArchiveButtons === 'function') {
      window.addArchiveButtons();
    }
    
    if (typeof window.injectArchiveButton === 'function') {
      window.injectArchiveButton();
    }
    
    // Setup mutation observer if needed
    setupObserver();
  }
}

// Function to setup mutation observer to watch for new messages
function setupObserver() {
  // Skip if already defined
  if (window.xDmArchiverObserverActive) return;
  
  const observer = new MutationObserver(mutations => {
    // Look for conversation elements being added
    const hasRelevantChanges = mutations.some(mutation => 
      Array.from(mutation.addedNodes).some(node => 
        node.nodeType === 1 && 
        (node.matches('[data-testid="conversation"]') || 
         node.querySelector('[data-testid="conversation"]'))
      )
    );
    
    if (hasRelevantChanges) {
      if (typeof window.addArchiveButtons === 'function') {
        window.addArchiveButtons();
      }
    }
  });
  
  // Observe the entire document for changes
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Mark observer as active
  window.xDmArchiverObserverActive = true;
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'getArchived') {
    chrome.storage.local.get(['archivedMessages'], (result) => {
      sendResponse({ archived: result.archivedMessages || [] });
    });
    return true; // Indicates asynchronous response
  } else if (request.type === 'clearArchive') {
    chrome.storage.local.set({ archivedMessages: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  } else if (request.type === 'initializeArchiver') {
    // Handle request to initialize from content script
    if (sender.tab) {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        function: initializeArchiver
      });
    }
    return true;
  }
});