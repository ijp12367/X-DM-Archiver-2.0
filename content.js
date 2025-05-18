let isUpdatingArchive = false;
const processedMessages = new WeakSet();
let debounceTimer = null;
// Add a variable to track the current sort order
let currentSortOrder = 'newest'; // 'newest' or 'oldest'
// Add a variable to store the search query
let searchQuery = '';
// Add a variable to track panel position
let panelPosition = { left: null, top: null };
// Add a variable to track panel dimensions
let panelDimensions = { width: 460, height: null };
// Add a variable to track selected messages for restoration
let selectedMessages = new Set();
// Track if observer is initialized
let xDmArchiverObserverActive = false;
// Character limit for notes preview
const NOTES_PREVIEW_LIMIT = 80;
// Size tiers for responsive design
const SIZE_TIERS = {
    SMALL: 'small',
    MEDIUM: 'medium',
    DEFAULT: 'default'
};
// Current size tier
let currentSizeTier = SIZE_TIERS.DEFAULT;

function getMessageId(msgElement) {
    const itemId = msgElement.getAttribute('data-item-id');
    if (itemId) return itemId; // This is the most reliable, no change here

    const msgContent = msgElement.innerText || '';
    // Clean the text that might be used for ID generation
    const cleanedMsgContentForId = cleanTextForId(msgContent);

    // Check for group chat based on original content, as cleaning might alter group indicators
    const isGroupChat = msgContent.includes(',') && msgContent.includes('and');

    if (isGroupChat) {
        // Use the first line of the *cleaned* content for the group ID
        const firstLine = cleanedMsgContentForId.split('\n')[0];
        return 'group_' + firstLine.trim().slice(0, 50);
    }

    // Fallback to a slice of the *cleaned* content
    return cleanedMsgContentForId.slice(0, 30);
}

// New function to extract group chat names
function extractGroupChatName(msgElement) {
    // Try the specific selector for group chat names
    const nameSpan = msgElement.querySelector('.r-dnmrzs.r-1udh08x span, [data-testid="conversation"] span');
    if (nameSpan && nameSpan.textContent.includes(',') && nameSpan.textContent.includes('and')) {
        return nameSpan.textContent.trim();
    }

    // Fallback: Try to get the first line of text content that matches group chat pattern
    const content = msgElement.innerText || '';
    const lines = content.split('\n');
    for (const line of lines) {
        if (line.includes(',') && line.includes('and')) {
            // This looks like a group chat header line
            return line.trim();
        }
    }

    // If we couldn't find a proper format, try to construct one from participants
    if (msgElement.querySelectorAll('img[src*="profile"]').length > 1) {
        const textNodes = Array.from(msgElement.querySelectorAll('span, strong'))
            .filter(el => (el.textContent || '').trim().length > 0)
            .map(el => el.textContent.trim());
        
        // Look for name-like texts (avoiding timestamps, "accepted request", etc.)
        const potentialNames = textNodes.filter(text => 
            !text.includes('accepted') && 
            !text.includes('You') && 
            !text.includes('·') &&
            text.length > 1 && 
            text.length < 30
        );
        
        if (potentialNames.length > 0) {
            return potentialNames[0];
        }
    }
    
    return null;
}

function debounce(func, wait) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(func, wait);
}

function safeAddArchiveButtons() {
    debounce(() => {
        if (!isUpdatingArchive) {
            addArchiveButtons();
            injectArchiveButton();
        }
    }, 300);
}

function forceRefreshMessageVisibility() {
    chrome.storage.local.get(['archivedMessages'], result => {
        const archived = result.archivedMessages || [];
        const archivedIds = new Set(archived.map(m => m.id));
        const messages = document.querySelectorAll('[data-testid="conversation"]');

        // Process in a non-blocking way using setTimeout
        // to prevent UI freezing with many messages
        let index = 0;

        function processNextBatch() {
            const endIndex = Math.min(index + 10, messages.length);

            for (let i = index; i < endIndex; i++) {
                const msg = messages[i];
                const msgId = getMessageId(msg);

                if (archivedIds.has(msgId)) {
                    msg.style.display = 'none';
                    msg.setAttribute('data-archived', 'true');
                } else {
                    msg.style.display = '';
                    msg.removeAttribute('data-archived');
                    msg.style.visibility = 'visible';
                    msg.style.opacity = '1';
                    void msg.offsetHeight; // Force reflow
                }
            }

            index = endIndex;

            if (index < messages.length) {
                setTimeout(processNextBatch, 0);
            }
        }

        processNextBatch();
    });
}

function addArchiveButtons() {
    //if (window.location.pathname.includes('/messages/requests')) return;

    chrome.storage.local.get(['archivedMessages'], result => {
        const archived = result.archivedMessages || [];
        const archivedIds = new Set(archived.map(m => m.id));
        const messages = document.querySelectorAll('[data-testid="conversation"]');

        messages.forEach(msg => {
            if (processedMessages.has(msg)) return;
            const msgId = getMessageId(msg);

            if (!msg.querySelector('.archive-btn') && !window.location.pathname.includes('/messages/requests')) {
                const btn = document.createElement('button');
                btn.textContent = '📥';
                btn.className = 'archive-btn';
                btn.style.position = 'absolute';
                btn.style.bottom = '5px';
                btn.style.right = '5px';
                btn.style.width = '32px';
                btn.style.height = '32px';
                btn.style.fontSize = '16px';
                btn.style.backgroundColor = '#1d9bf0';
                btn.style.color = 'white';
                btn.style.border = 'none';
                btn.style.borderRadius = '50%';
                btn.style.cursor = 'pointer';
                btn.style.display = 'flex';
                btn.style.alignItems = 'center';
                btn.style.justifyContent = 'center';
                btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
                btn.style.opacity = '0'; // Start hidden
                btn.style.transition = 'opacity 0.2s ease-in-out';

                msg.style.position = 'relative'; // Ensure parent is positioned

                // Show archive button on hover
                msg.addEventListener('mouseenter', () => {
                    btn.style.opacity = '1';
                });

                msg.addEventListener('mouseleave', () => {
                    btn.style.opacity = '0';
                });

                btn.onclick = (e) => {
                    e.stopPropagation();
                    archiveMessage(msg);
                };

                msg.appendChild(btn);
            }


            if (archivedIds.has(msgId)) {
                msg.style.display = 'none';
                msg.setAttribute('data-archived', 'true');
            } else {
                msg.style.display = '';
                msg.removeAttribute('data-archived');
            }

            processedMessages.add(msg);
        });
    });
}

function archiveMessage(msgElement) {
    const msgId = getMessageId(msgElement);

    // Store the entire HTML structure of the message for better reproduction in archive
    const msgHTML = msgElement.cloneNode(true).outerHTML;

    // Also store text content for fallback and search
    const msgContent = msgElement.innerText;

    // Try to extract the timestamp from the message
    let messageTimestamp = null;

    // Look for timestamps in the message (e.g., "· 1h", "· 3m", etc)
    const timeMatches = msgContent.match(/·\s*(\d+[hmd])/);
    if (timeMatches) {
        const timeMatch = timeMatches[1];
        const now = new Date();

        // Convert Twitter time format to a timestamp
        if (timeMatch.endsWith('m')) {
            const minutes = parseInt(timeMatch.slice(0, -1));
            messageTimestamp = new Date(now.getTime() - minutes * 60 * 1000).toISOString();
        } else if (timeMatch.endsWith('h')) {
            const hours = parseInt(timeMatch.slice(0, -1));
            messageTimestamp = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
        } else if (timeMatch.endsWith('d')) {
            const days = parseInt(timeMatch.slice(0, -1));
            messageTimestamp = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
        }
    }

    // Look for date stamps in other formats if time wasn't found
    if (!messageTimestamp) {
        // Try matching patterns like "May 14" or "Apr 2"
        const dateMatches = msgContent.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
        if (dateMatches) {
            const month = dateMatches[1];
            const day = parseInt(dateMatches[2]);
            // Check if year is captured in the match
            const year = dateMatches[3] ? parseInt(dateMatches[3]) : new Date().getFullYear();

            // Map month name to month number
            const monthMap = {
                'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
            };

            messageTimestamp = new Date(year, monthMap[month], day).toISOString();
        }
    }

    // Extract username from the message
    let username = '';
    let handle = '';

    // Try different DOM selectors for the username/handle
    // Twitter's structure is complex, so we try different selector patterns

    // Try to find the username directly from the conversation row
    const conversationLink = msgElement.querySelector('a[role="link"]');
    if (conversationLink) {
        const linkText = conversationLink.textContent.trim();
        // Check if there's a username with handle pattern
        const userMatch = linkText.match(/^([^@]+)(@\S+)/);
        if (userMatch) {
            username = userMatch[1].trim();
            handle = userMatch[2].trim();
        } else {
            username = linkText;
        }
    }

    // If we couldn't find the username from the link, try getting it from the first line of text
    if (!username) {
        // Look for any text content that might be a name
        const firstLine = msgContent.split('\n')[0].trim();
        // Check if it looks like a username (not "You accepted...")
        if (firstLine && !firstLine.includes('accepted') && !firstLine.includes('You')) {
            username = firstLine;

            // Check if there's a handle pattern in the first line
            const handleMatch = firstLine.match(/(@\S+)/);
            if (handleMatch) {
                handle = handleMatch[0];
                username = firstLine.replace(handle, '').trim();
            }
        }
    }

    // Last resort - extract from strong elements or spans
    if (!username) {
        const nameElement = msgElement.querySelector('strong, span[dir="auto"]');
        if (nameElement) {
            username = nameElement.textContent.trim();
        }
    }

    // Since Twitter displays either "Name" or "Name @handle", we parse that structure
    if (username && username.includes('@')) {
        const parts = username.split('@');
        if (parts.length > 1) {
            username = parts[0].trim();
            handle = '@' + parts[1].trim();
        }
    }

    // Fall back to name from the content if we still don't have one
    if (!username || username === 'You') {
        // Look for patterns in the content like "Name, CHOLO and 29 more"
        const contentMatch = msgContent.match(/([A-Za-z0-9_.-]+(?:,\s*[A-Za-z0-9_.-]+)*)(?:\s+and\s+\d+\s+more)?/);
        if (contentMatch) {
            username = contentMatch[1];
        } else {
            // Try to extract a name from various formats
            const lines = msgContent.split('\n');
            const potentialNames = lines.filter(line =>
                line.length > 0 &&
                !line.includes('You accepted') &&
                !line.includes('1h') &&
                line.length < 30
            );

            if (potentialNames.length > 0) {
                username = potentialNames[0];
            }
        }
    }

    // Final fallback if all extraction attempts failed
    if (!username || username === 'You') {
        // Extract from text nodes that are likely to contain the name
        const textNodes = [];
        function extractText(node) {
            if (node.nodeType === 3) {
                const text = node.textContent.trim();
                if (text && text.length > 0) {
                    textNodes.push(text);
                }
            } else if (node.nodeType === 1) {
                Array.from(node.childNodes).forEach(extractText);
            }
        }
        extractText(msgElement);

        // Look for potential name patterns (not common Twitter UI text)
        const potentialNames = textNodes.filter(text =>
            text.length > 1 &&
            !text.includes('You accepted') &&
            !text.includes('Message requests') &&
            !text.includes('accepted the request') &&
            !text.startsWith('You') &&
            text.length < 30
        );

        if (potentialNames.length > 0) {
            // Sort by length (shorter texts are more likely to be names)
            potentialNames.sort((a, b) => a.length - b.length);
            username = potentialNames[0];

            // Check if this contains a handle
            const handleMatch = username.match(/(@\S+)/);
            if (handleMatch) {
                handle = handleMatch[0];
                username = username.replace(handle, '').trim();
            }
        }
    }

    // For cases like "Natella, CHOLO and 29 more"
    if (username && username.includes(',')) {
        username = username.split(',')[0].trim();
    }

    // If username still has time markers like "· 1h", clean them
    if (username) {
        username = username.replace(/·\s*\d+[hm]/, '').trim();
    }

    // Extract actual message content
    // Extract actual message content
    let messageText = '';
    if (msgContent.includes('You accepted the request')) {
        messageText = 'You accepted the request';
    } else {
        // Try to get message content using the provided selector
        const messageElement = msgElement.querySelector('.css-175oi2r.r-yca7ao.r-1udh08x.r-22olma > div > span');
        
        if (messageElement) {
            messageText = messageElement.textContent.trim();
        } else {
            // Fallback to text content approach
            const contentLines = msgContent.split('\n');
            if (contentLines.length > 1) {
                messageText = contentLines.slice(1).join(' ').trim();
            }
        }
        
        // Clean the message content thoroughly
        if (messageText) {
            // Remove the archive button emoji
            messageText = messageText.replace(/📥/g, '');
            
            // Pattern to match date formats with or without bullet point
            const datePattern = /(?:^|\s)[·•]?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s+\d{4})?\s*/gi;
            
            // First try to remove the date format that appears after the username pattern
            const usernameTimestampSeparatorIndex = messageText.indexOf(' · ');
            if (usernameTimestampSeparatorIndex !== -1) {
                // This looks like a header section, try to find the actual content after it
                const potentialMessageStart = messageText.indexOf('\n');
                if (potentialMessageStart !== -1) {
                    messageText = messageText.substring(potentialMessageStart).trim();
                }
            }
            
            // Remove any remaining date patterns from the beginning
            messageText = messageText.replace(datePattern, ' ');
            
            // Special case: handle "· May X" pattern that appears at start of content
            messageText = messageText.replace(/^[·•]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s+\d{4})?\s*/i, '');
            
            // Remove timestamps
            messageText = messageText.replace(/[·•]\s*\d+[hmd]/g, '');
            
            // Clean up any remaining bullet points at the beginning
            messageText = messageText.replace(/^[·•]\s*/, '');
            
            // Clean extra whitespace
            messageText = messageText.replace(/\s+/g, ' ').trim();
        }
        
        // Only use fallback if truly nothing was found
        if (!messageText) {
            messageText = 'No message content';
        }
    }

    // Check if this is a group chat
    const isGroupChat = msgContent.includes(',') && msgContent.includes('and');

    // Get all avatar URLs if they exist
    let avatarUrls = [];
    const avatars = msgElement.querySelectorAll('img[src*="profile"]');

    if (avatars.length > 0) {
        // Store up to 4 avatar URLs for group chats
        avatars.forEach((avatar, index) => {
            if (index < 4) {
                avatarUrls.push(avatar.src);
            }
        });
    }

    // Extract participants and count for group chats
    let participants = [];
    let participantCount = 0;
    // Add group name variable
    let groupName = '';

    if (isGroupChat) {
        // Try to extract the full group chat name
        groupName = extractGroupChatName(msgElement) || '';
        
        // Try to extract participant names and count from first line content
        const firstLine = msgContent.split('\n')[0];
        // Format often like: "Person1, Person2, and 3 more"
        const morePeopleMatch = firstLine.match(/and\s+(\d+)\s+more/);
        if (morePeopleMatch) {
            participantCount = parseInt(morePeopleMatch[1], 10) + 2; // +2 for the named participants
        }

        // Extract individual names
        const nameMatches = firstLine.match(/([^,]+)(?:,\s*([^,]+))?(?:,\s*([^,]+))?(?:\s+and\s+(\d+)\s+more)?/);

        if (nameMatches) {
            for (let i = 1; i < nameMatches.length; i++) {
                if (nameMatches[i] && !nameMatches[i].includes('more') && !nameMatches[i].includes('and')) {
                    participants.push(nameMatches[i].trim());
                }
            }
        }

        // If we couldn't extract the count from "X more", just use the number of participants we found
        if (participantCount === 0 && participants.length > 0) {
            participantCount = participants.length;
        } else if (participantCount === 0) {
            participantCount = avatarUrls.length || 2; // Fallback if no names found, at least 2 for a group
        }
    }

    // Use known Twitter usernames patterns as fallback
    if ((!username || username === 'User') && msgContent.includes('eth')) {
        // Check for cryptocurrency usernames with .eth
        const ethMatch = msgContent.match(/([A-Za-z0-9_.-]+\.eth)/i);
        if (ethMatch) {
            username = ethMatch[1];
        }
    }

    // Clean up username one last time
    if (username) {
        // Remove any timestamps
        username = username.replace(/·\s*\d+[hmd]/, '').trim();

        // Remove any handles from username
        if (handle) {
            username = username.replace(handle, '').trim();
        }
    }

    chrome.storage.local.get(['archivedMessages'], result => {
        const archived = result.archivedMessages || [];
        if (!archived.some(m => m.id === msgId)) {
            archived.push({
                id: msgId,
                content: msgContent,
                html: msgHTML,
                avatarUrls: avatarUrls,
                username: username || 'User',
                handle: handle || '',
                timestamp: new Date().toISOString(),
                messageTimestamp: messageTimestamp || new Date().toISOString(), // Use extracted timestamp or now
                messagePreview: messageText || 'You accepted the request',
                isGroupChat: isGroupChat, // Add flag for group chats
                participants: participants, // Add participant list for group chats
                participantCount: participantCount, // Add participant count
                groupName: groupName, // Add the full group chat name
                notes: '' // Add notes field for message notes
            });
            isUpdatingArchive = true;
            chrome.storage.local.set({ archivedMessages: archived }, () => {
                isUpdatingArchive = false;
                msgElement.style.display = 'none';
                msgElement.setAttribute('data-archived', 'true');
                refreshArchiveList();
            });
        }
    });
}

function restoreSelectedMessages() {
    if (selectedMessages.size === 0) return;

    chrome.storage.local.get(['archivedMessages'], result => {
        const archived = result.archivedMessages || [];
        // Find the messages to restore
        const messagesToRestore = archived.filter(m => selectedMessages.has(m.id));

        // Filter out the messages to restore
        const updatedArchive = archived.filter(m => !selectedMessages.has(m.id));

        // Set flag to prevent other operations during update
        isUpdatingArchive = true;

        chrome.storage.local.set({ archivedMessages: updatedArchive }, () => {
            // Update the UI first
            refreshArchiveList();

            // For each message to restore, find and make it visible
            messagesToRestore.forEach(messageData => {
                const messages = document.querySelectorAll('[data-testid="conversation"]');
                let restored = false;

                // Try standard approach first
                messages.forEach(msg => {
                    const currentMsgId = getMessageId(msg);
                    if (currentMsgId === messageData.id) {
                        msg.style.display = '';
                        msg.removeAttribute('data-archived');
                        msg.style.visibility = 'visible';
                        msg.style.opacity = '1';
                        void msg.offsetHeight; // Force reflow
                        restored = true;
                    }
                });

                // If standard approach didn't work, try additional methods for group chats
                if (!restored && messageData.isGroupChat) {
                    // For group chats, we may need different selectors or approaches
                    // This could include looking for partial content matches or other attributes

                    // First, try getting all conversations that might be groups
                    const potentialGroupChats = Array.from(messages).filter(msg => {
                        const content = msg.innerText || '';
                        return content.includes(',') && content.includes('and');
                    });

                    // Try to find a match based on content similarity
                    for (const chat of potentialGroupChats) {
                        const chatContent = chat.innerText || '';
                        // Check if key parts of the group name appear in both
                        if (messageData.username && chatContent.includes(messageData.username)) {
                            chat.style.display = '';
                            chat.removeAttribute('data-archived');
                            chat.style.visibility = 'visible';
                            chat.style.opacity = '1';
                            void chat.offsetHeight; // Force reflow
                            break;
                        }
                    }
                }
            });

            // Force virtual list redraw
            forceVirtualListRedraw();

            // Clear selected messages
            selectedMessages.clear();

            // Release the lock
            isUpdatingArchive = false;

            // Refresh the page after a small delay
            setTimeout(() => {
                window.location.reload();
            }, 300);
        });
    });
}

function forceVirtualListRedraw() {
    const container = document.querySelector('[role="presentation"]');
    if (container) {
        container.scrollTop += 1;
        container.scrollTop -= 1;
    } else {
        window.scrollBy(0, 1);
        window.scrollBy(0, -1);
    }
}

function injectArchiveButton() {
    const path = window.location.pathname;

    // Only show on messages page
    if (!path.startsWith('/messages')) return;

    // Prevent duplicate button
    if (document.querySelector('#archiveListBtn')) return;

    const settingsIcon = document.querySelector('[aria-label="Settings"], [data-testid="settings"]');
    if (!settingsIcon) return;

    const archiveBtn = document.createElement('button');
    archiveBtn.id = 'archiveListBtn';
    archiveBtn.innerHTML = `
        <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;">
            <g><path d="M19.9 23.5c-.2 0-.3 0-.4-.1L12 17.9l-7.5 5.4c-.2.2-.5.2-.8.1-.2-.1-.4-.4-.4-.7V5.6c0-1.2 1-2.2 2.2-2.2h12.8c1.2 0 2.2 1 2.2 2.2v17.1c0 .3-.2.5-.4.7 0 .1-.1.1-.2.1z"></path></g>
        </svg>
    `;
    archiveBtn.title = 'Toggle Archive Panel';
    archiveBtn.style.marginLeft = '10px';
    archiveBtn.style.border = 'none';
    archiveBtn.style.background = 'none';
    archiveBtn.style.cursor = 'pointer';
    archiveBtn.style.borderRadius = '50%';
    archiveBtn.style.width = '36px';
    archiveBtn.style.height = '36px';
    archiveBtn.style.display = 'flex';
    archiveBtn.style.alignItems = 'center';
    archiveBtn.style.justifyContent = 'center';

    archiveBtn.addEventListener('mouseenter', () => {
        archiveBtn.style.backgroundColor = 'rgba(29, 155, 240, 0.1)';
    });

    archiveBtn.addEventListener('mouseleave', () => {
        archiveBtn.style.backgroundColor = 'transparent';
    });

    archiveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleArchivePanel();
    });

    settingsIcon.parentElement.appendChild(archiveBtn);
}


function toggleArchivePanel() {
    const existingPanel = document.querySelector('#archivePanel');
    if (existingPanel) {
        existingPanel.remove();
    } else {
        showArchivePanel();
    }
}

// Function to determine the current size tier based on panel dimensions
function determineSizeTier(width) {
    if (width < 360) {
        return SIZE_TIERS.SMALL;
    } else if (width < 420) {
        return SIZE_TIERS.MEDIUM;
    } else {
        return SIZE_TIERS.DEFAULT;
    }
}

// Function to get font size based on the current size tier
function getFontSize(defaultSize, mediumSize, smallSize) {
    switch (currentSizeTier) {
        case SIZE_TIERS.SMALL:
            return smallSize;
        case SIZE_TIERS.MEDIUM:
            return mediumSize;
        default:
            return defaultSize;
    }
}

// Function to update text scaling based on panel size
function updateTextScaling() {
    const panel = document.querySelector('#archivePanel');
    if (!panel) return;

    const width = parseInt(panel.style.width);
    currentSizeTier = determineSizeTier(width);

    // Update header title size
    const headerTitle = panel.querySelector('#archivePanel h2');
    if (headerTitle) {
        headerTitle.style.fontSize = getFontSize('20px', '18px', '16px');
    }

    // Update buttons text size
    const buttons = panel.querySelectorAll('button:not(.archive-btn)');
    buttons.forEach(btn => {
        btn.style.fontSize = getFontSize('14px', '13px', '12px');
        btn.style.padding = getFontSize('6px 16px', '5px 14px', '4px 10px');
    });

    // Update sort label size
    const sortLabel = panel.querySelector('.sort-label');
    if (sortLabel) {
        sortLabel.style.fontSize = getFontSize('15px', '14px', '13px');
    }

    // Update message content size
    const msgUsernames = panel.querySelectorAll('.message-username');
    msgUsernames.forEach(el => {
        el.style.fontSize = getFontSize('15px', '14px', '13px');
    });

    const msgPreviews = panel.querySelectorAll('.message-preview');
    msgPreviews.forEach(el => {
        el.style.fontSize = getFontSize('14px', '13px', '12px');
    });

    // Update notes text size
    const notes = panel.querySelectorAll('.message-notes');
    notes.forEach(el => {
        el.style.fontSize = getFontSize('13px', '12px', '11px');
    });
}

// Function to export archived messages
function exportArchivedMessages() {
    chrome.storage.local.get(['archivedMessages'], result => {
        const archived = result.archivedMessages || [];
        
        // Create a JSON blob
        const dataStr = JSON.stringify({
            archivedMessages: archived,
            exportDate: new Date().toISOString(),
            version: '1.0'
        });
        const blob = new Blob([dataStr], {type: 'application/json'});
        
        // Create a download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `twitter-dm-archive-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        
        // Clean up
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    });
}

// Function to import archived messages
function importArchivedMessages() {
    // Create a file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = event => {
            try {
                const data = JSON.parse(event.target.result);
                
                // Validate the data format
                if (!data.archivedMessages || !Array.isArray(data.archivedMessages)) {
                    alert('Invalid archive file format.');
                    return;
                }
                
                // Ask whether to replace or merge
                const mergeChoice = confirm('Do you want to merge with existing archives? Click OK to merge, Cancel to replace all.');
                
                chrome.storage.local.get(['archivedMessages'], result => {
                    let currentArchived = result.archivedMessages || [];
                    let newArchived = [];
                    
                    if (mergeChoice) {
                        // Merge: Keep existing messages and add new ones
                        // Use a Set to track IDs we already have
                        const existingIds = new Set(currentArchived.map(m => m.id));
                        
                        // Add all current messages first
                        newArchived = [...currentArchived];
                        
                        // Add imported messages that don't exist yet
                        data.archivedMessages.forEach(msg => {
                            if (!existingIds.has(msg.id)) {
                                newArchived.push(msg);
                            }
                        });
                    } else {
                        // Replace all existing with imported
                        newArchived = data.archivedMessages;
                    }
                    
                    // Update the storage
                    isUpdatingArchive = true;
                    chrome.storage.local.set({ archivedMessages: newArchived }, () => {
                        isUpdatingArchive = false;
                        alert(`Import complete. ${newArchived.length} messages in archive.`);
                        refreshArchiveList();
                        forceRefreshMessageVisibility();
                    });
                });
            } catch (error) {
                console.error('Error parsing import file:', error);
                alert('Error importing file. Please ensure it\'s a valid archive JSON file.');
            }
        };
        reader.readAsText(file);
    };
    
    // Trigger the file selection dialog
    input.click();
}

function showArchivePanel() {
    // Reset selected messages when showing the panel
    selectedMessages.clear();

    // Load the saved panel position and dimensions
    chrome.storage.local.get(['panelPosition', 'panelDimensions'], result => {
        const savedPosition = result.panelPosition || {};
        const savedDimensions = result.panelDimensions || {};
        
        panelPosition = savedPosition;
        
        // Apply saved dimensions or use defaults
        if (savedDimensions.width) {
            panelDimensions.width = savedDimensions.width;
        }
        if (savedDimensions.height) {
            panelDimensions.height = savedDimensions.height;
        }

        const panel = document.createElement('div');
        panel.id = 'archivePanel';
        panel.style.position = 'fixed';

        // Apply saved position if available, otherwise use default position
        if (panelPosition.left !== undefined && panelPosition.top !== undefined) {
            panel.style.left = panelPosition.left + 'px';
            panel.style.top = panelPosition.top + 'px';
        } else {
            panel.style.top = '80px';
            panel.style.right = '20px';
        }

        // Apply saved dimensions
        panel.style.width = panelDimensions.width + 'px';
        if (panelDimensions.height) {
            panel.style.height = panelDimensions.height + 'px';
        } else {
            // Default height behavior
            panel.style.maxHeight = '80vh';
        }
        
        // Make responsive to window size
        panel.style.maxWidth = '90vw'; // Limit width to 90% of viewport width
        panel.style.maxHeight = '80vh'; // Limit height to 80% of viewport height
        panel.style.minWidth = '320px'; // Minimum width for usability
        panel.style.minHeight = '300px'; // Minimum height for usability

        // Ensure panel stays in viewport
        panel.style.overflowX = 'hidden';
        panel.style.backgroundColor = '#ffffff';
        panel.style.border = 'none';
        panel.style.borderRadius = '16px';
        panel.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        panel.style.zIndex = '9999';
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';

        // Detect if the site is in dark mode
        const isDarkMode = document.body.classList.contains('night-mode') ||
            document.documentElement.classList.contains('dark') ||
            document.querySelector('html[data-color-mode="dark"]') !== null ||
            (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

        if (isDarkMode) {
            panel.style.backgroundColor = '#15202b';
            panel.style.color = '#ffffff';
        }

        // Updated header with export/import buttons
        panel.innerHTML = `
            <div id="archiveHeader" style="padding: 16px; border-bottom: 1px solid ${isDarkMode ? '#38444d' : '#eff3f4'}; display: flex; justify-content: space-between; align-items: center; cursor: move;">
                <div style="display: flex; align-items: center;">
                    <span class="drag-handle" style="margin-right: 10px; font-size: 16px; color: ${isDarkMode ? '#8899a6' : '#536471'};">☰</span>
                    <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: ${isDarkMode ? '#ffffff' : '#0f1419'};">Archived DMs</h2>
                </div>
                <div>
                    <button id="exportArchive" style="background: ${isDarkMode ? '#2d3741' : '#eff3f4'}; border: none; border-radius: 9999px; padding: 6px 16px; margin-right: 8px; cursor: pointer; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-weight: 500; font-size: 14px;">Export</button>
                    <button id="importArchive" style="background: ${isDarkMode ? '#2d3741' : '#eff3f4'}; border: none; border-radius: 9999px; padding: 6px 16px; margin-right: 8px; cursor: pointer; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-weight: 500; font-size: 14px;">Import</button>
                    <button id="clearArchive" style="background: ${isDarkMode ? '#2d3741' : '#eff3f4'}; border: none; border-radius: 9999px; padding: 6px 16px; margin-right: 8px; cursor: pointer; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-weight: 500; font-size: 14px;">Clear All</button>
                    <button id="closeArchive" style="background: ${isDarkMode ? '#2d3741' : '#eff3f4'}; border: none; border-radius: 9999px; padding: 6px 16px; cursor: pointer; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-weight: 500; font-size: 14px;">Close</button>
                </div>
            </div>
            <div style="padding: 12px 16px; border-bottom: 1px solid ${isDarkMode ? '#38444d' : '#eff3f4'};">
                <div style="display: flex; position: relative; margin-bottom: 12px;">
                    <input id="archiveSearch" type="text" placeholder="Search archived messages..." style="width: 100%; padding: 8px 12px 8px 36px; border-radius: 9999px; border: 1px solid ${isDarkMode ? '#38444d' : '#eff3f4'}; background-color: ${isDarkMode ? '#253341' : '#f7f9f9'}; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-size: 14px; outline: none;">
                    <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: ${isDarkMode ? '#8899a6' : '#536471'};">🔍</span>
                    <button id="clearSearch" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; padding: 0; cursor: pointer; color: ${isDarkMode ? '#8899a6' : '#536471'}; font-size: 16px; display: none;">×</button>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center;">
                        <span class="sort-label" style="font-size: 15px; font-weight: 500; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; margin-right: 12px;">Sort:</span>
                        <div class="sort-buttons" style="display: flex; gap: 8px;">
                            <button id="sortNewest" class="sort-btn ${currentSortOrder === 'newest' ? 'active' : ''}" style="background: ${currentSortOrder === 'newest' ? '#1d9bf0' : (isDarkMode ? '#2d3741' : '#eff3f4')}; border: none; border-radius: 9999px; padding: 6px 12px; cursor: pointer; color: ${currentSortOrder === 'newest' ? '#ffffff' : (isDarkMode ? '#ffffff' : '#0f1419')}; font-weight: 500; font-size: 14px;">Newest</button>
                            <button id="sortOldest" class="sort-btn ${currentSortOrder === 'oldest' ? 'active' : ''}" style="background: ${currentSortOrder === 'oldest' ? '#1d9bf0' : (isDarkMode ? '#2d3741' : '#eff3f4')}; border: none; border-radius: 9999px; padding: 6px 12px; cursor: pointer; color: ${currentSortOrder === 'oldest' ? '#ffffff' : (isDarkMode ? '#ffffff' : '#0f1419')}; font-weight: 500; font-size: 14px;">Oldest</button>
                        </div>
                    </div>
                    <button id="restoreSelectedBtn" class="restore-selected-btn" style="background: ${isDarkMode ? '#2d3741' : '#eff3f4'}; border: none; border-radius: 9999px; padding: 6px 16px; cursor: pointer; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-weight: 500; font-size: 14px;" disabled>Restore</button>
                </div>
            </div>
            <div id="archiveList" style="padding: 0; overflow-y: auto; flex: 1;"></div>
            <div id="resizeHandle" style="position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: nwse-resize; display: flex; justify-content: flex-end; align-items: flex-end;">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="${isDarkMode ? '#8899a6' : '#536471'}">
                    <path d="M11 9.5H13V11.5H11V9.5ZM9 11.5H11V13.5H9V11.5ZM13 11.5H15V13.5H13V11.5ZM11 13.5H13V15.5H11V13.5Z"></path>
                </svg>
            </div>
        `;

        document.body.appendChild(panel);

        document.getElementById('closeArchive').onclick = () => panel.remove();
        document.getElementById('clearArchive').onclick = () => {
            if (confirm('Are you sure you want to clear all archived messages?')) {
                isUpdatingArchive = true;
                chrome.storage.local.set({ archivedMessages: [] }, () => {
                    isUpdatingArchive = false;
                    selectedMessages.clear();
                    forceRefreshMessageVisibility();
                    refreshArchiveList();
                });
            }
        };
        
        // Add event listeners for export/import buttons
        document.getElementById('exportArchive').addEventListener('click', exportArchivedMessages);
        document.getElementById('importArchive').addEventListener('click', importArchivedMessages);

        // Add restore button functionality
        const restoreBtn = document.getElementById('restoreSelectedBtn');
        restoreBtn.addEventListener('click', () => {
            if (selectedMessages.size > 0) {
                restoreSelectedMessages();
                updateRestoreButton();
            }
        });

        // Set up search functionality
        const searchInput = document.getElementById('archiveSearch');
        const clearSearchBtn = document.getElementById('clearSearch');

        searchInput.addEventListener('input', () => {
            searchQuery = searchInput.value.trim().toLowerCase();
            clearSearchBtn.style.display = searchQuery ? 'block' : 'none';
            refreshArchiveList();
        });

        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchQuery = '';
            clearSearchBtn.style.display = 'none';
            refreshArchiveList();
        });

        // Add event listeners for sort buttons
        document.getElementById('sortNewest').addEventListener('click', () => {
            if (currentSortOrder !== 'newest') {
                currentSortOrder = 'newest';
                updateSortButtonStyles();
                refreshArchiveList();
            }
        });

        document.getElementById('sortOldest').addEventListener('click', () => {
            if (currentSortOrder !== 'oldest') {
                currentSortOrder = 'oldest';
                updateSortButtonStyles();
                refreshArchiveList();
            }
        });

        // Make the panel draggable
        makeDraggable(panel, document.getElementById('archiveHeader'));
        
        // Make the panel resizable
        makeResizable(panel, document.getElementById('resizeHandle'));

        // Add window resize event handler to ensure panel remains visible
        const handleWindowResize = () => {
            // Get panel position and dimensions
            const panelRect = panel.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Check if panel is partially outside the viewport
            let newLeft = parseFloat(panel.style.left); // Use current style directly
            let newTop = parseFloat(panel.style.top);   // Use current style directly

            // Adjust horizontal position if needed
            if (panelRect.right > viewportWidth) {
                newLeft = Math.max(0, viewportWidth - panelRect.width - 20);
            }
            if (panelRect.left < 0) {
                newLeft = 20;
            }

            // Adjust vertical position if needed
            if (panelRect.bottom > viewportHeight) {
                newTop = Math.max(0, viewportHeight - panelRect.height - 20);
            }
            if (panelRect.top < 0) {
                newTop = 20;
            }

            // Apply new position if it changed
            const currentLeft = parseFloat(panel.style.left);
            const currentTop = parseFloat(panel.style.top);

            if (newLeft !== currentLeft || newTop !== currentTop) {
                panel.style.left = newLeft + 'px';
                panel.style.top = newTop + 'px';

                // Update stored position
                panelPosition = { left: newLeft, top: newTop };
                chrome.storage.local.set({ panelPosition });
            }
        };

        // Add resize handler
        window.addEventListener('resize', handleWindowResize);

        // Initial call to ensure panel is in viewport and text scaling is applied
        handleWindowResize();
        updateTextScaling();

        // Remove the resize handler when panel is closed
        document.getElementById('closeArchive').addEventListener('click', () => {
            window.removeEventListener('resize', handleWindowResize);
        });

        refreshArchiveList();
    });
}

// Function to make the panel resizable
function makeResizable(element, handle) {
    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    handle.addEventListener('mousedown', (e) => {
        // Only handle left mouse button
        if (e.button !== 0) return;

        e.preventDefault();
        isResizing = true;

        // Get initial position and size
        startX = e.clientX;
        startY = e.clientY;
        startWidth = parseInt(document.defaultView.getComputedStyle(element).width, 10);
        startHeight = parseInt(document.defaultView.getComputedStyle(element).height, 10);

        // Add cursor style and prevent text selection
        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        // Calculate new width and height
        const newWidth = startWidth + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);

        // Apply minimum dimensions
        const width = Math.max(320, newWidth); // Minimum width: 320px
        const height = Math.max(300, newHeight); // Minimum height: 300px

        // Apply new dimensions
        element.style.width = width + 'px';
        element.style.height = height + 'px';

        // Update stored dimensions
        panelDimensions = { width, height };
        
        // Update text scaling based on new size
        updateTextScaling();
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;

            // Restore cursor style and text selection
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // Save the new dimensions to Chrome storage
            chrome.storage.local.set({ panelDimensions });
        }
    });

    // Handle case when mouse leaves the window
    document.addEventListener('mouseleave', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// Function to update the restore button state
function updateRestoreButton() {
    const restoreBtn = document.getElementById('restoreSelectedBtn');
    if (!restoreBtn) return;

    if (selectedMessages.size > 0) {
        restoreBtn.style.backgroundColor = '#1d9bf0';
        restoreBtn.style.color = '#ffffff';
        restoreBtn.disabled = false;
        restoreBtn.title = `Restore ${selectedMessages.size} message${selectedMessages.size > 1 ? 's' : ''}`;
    } else {
        const isDarkMode = document.body.classList.contains('night-mode') ||
            document.documentElement.classList.contains('dark') ||
            document.querySelector('html[data-color-mode="dark"]') !== null ||
            (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

        restoreBtn.style.backgroundColor = isDarkMode ? '#2d3741' : '#eff3f4';
        restoreBtn.style.color = isDarkMode ? '#ffffff' : '#0f1419';
        restoreBtn.disabled = true;
        restoreBtn.title = 'Select messages to restore';
    }
}

// Toggle selection of a message
function toggleMessageSelection(msgId) {
    if (selectedMessages.has(msgId)) {
        selectedMessages.delete(msgId);
    } else {
        selectedMessages.add(msgId);
    }

    updateRestoreButton();
    refreshArchiveList(); // To update checkbox style in the list
}

// Function to make an element draggable
function makeDraggable(element, handle) {
    let isDragging = false;
    let offsetX, offsetY;

    handle.addEventListener('mousedown', (e) => {
        // Only handle left mouse button
        if (e.button !== 0) return;
        
        // Don't start dragging if we clicked on a button or interactive element
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
            return;
        }

        e.preventDefault();
        isDragging = true;

        // Calculate the offset between mouse position and element top-left corner
        const rect = element.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        // Add cursor style to indicate dragging
        document.body.style.cursor = 'move';

        // Prevent text selection during drag
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        // Calculate the new position, accounting for the initial offset
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;

        // Constrain to viewport (optional, but good practice)
        const rect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        newLeft = Math.max(0, Math.min(newLeft, viewportWidth - rect.width));
        newTop = Math.max(0, Math.min(newTop, viewportHeight - rect.height));


        // Apply the new position
        element.style.left = newLeft + 'px';
        element.style.top = newTop + 'px';
        element.style.right = 'auto'; // Ensure right is not set
        element.style.bottom = 'auto'; // Ensure bottom is not set

        // Update the stored position
        panelPosition = { left: newLeft, top: newTop };

        // Save the position to Chrome storage (debounced or throttled for performance if needed)
        // For simplicity, direct save here. Consider debouncing if performance issues arise.
        chrome.storage.local.set({ panelPosition: panelPosition });
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;

            // Restore cursor style
            document.body.style.cursor = '';

            // Restore text selection
            document.body.style.userSelect = '';
        }
    });

    // In case the mouse leaves the window while dragging
    document.addEventListener('mouseleave', () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// Function to update the appearance of sort buttons
function updateSortButtonStyles() {
    const isDarkMode = document.body.classList.contains('night-mode') ||
        document.documentElement.classList.contains('dark') ||
        document.querySelector('html[data-color-mode="dark"]') !== null ||
        (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

    const newestBtn = document.getElementById('sortNewest');
    const oldestBtn = document.getElementById('sortOldest');

    if (newestBtn && oldestBtn) {
        // Update newest button
        newestBtn.style.background = currentSortOrder === 'newest' ? '#1d9bf0' : (isDarkMode ? '#2d3741' : '#eff3f4');
        newestBtn.style.color = currentSortOrder === 'newest' ? '#ffffff' : (isDarkMode ? '#ffffff' : '#0f1419');

        // Update oldest button
        oldestBtn.style.background = currentSortOrder === 'oldest' ? '#1d9bf0' : (isDarkMode ? '#2d3741' : '#eff3f4');
        oldestBtn.style.color = currentSortOrder === 'oldest' ? '#ffffff' : (isDarkMode ? '#ffffff' : '#0f1419');
    }
}

// Function to show notes modal for adding/editing notes
function showNotesModal(msgId) {
    // Get the message data
    chrome.storage.local.get(['archivedMessages'], result => {
        const archived = result.archivedMessages || [];
        const message = archived.find(m => m.id === msgId);

        if (!message) return;

        const isDarkMode = document.body.classList.contains('night-mode') ||
            document.documentElement.classList.contains('dark') ||
            document.querySelector('html[data-color-mode="dark"]') !== null ||
            (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'notes-modal-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        overlay.style.zIndex = '10000';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'notes-modal';
        modal.style.width = '400px';
        modal.style.maxWidth = '90%';
        modal.style.backgroundColor = isDarkMode ? '#15202b' : '#ffffff';
        modal.style.borderRadius = '16px';
        modal.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        modal.style.overflow = 'hidden';
        modal.style.fontFamily = '"TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

        // Create modal content
        modal.innerHTML = `
            <div class="notes-modal-header" style="padding: 16px; border-bottom: 1px solid ${isDarkMode ? '#38444d' : '#eff3f4'};">
                <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: ${isDarkMode ? '#ffffff' : '#0f1419'};">Message Notes</h2>
                <p style="margin: 8px 0 0 0; font-size: 14px; color: ${isDarkMode ? '#8899a6' : '#536471'};">Add notes to your archived message</p>
            </div>
            <div class="notes-modal-body" style="padding: 16px;">
                <textarea id="notes-textarea" placeholder="Add your notes here..." style="width: 100%; height: 150px; padding: 12px; border-radius: 8px; border: 1px solid ${isDarkMode ? '#38444d' : '#eff3f4'}; background-color: ${isDarkMode ? '#253341' : '#f7f9f9'}; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-size: 14px; resize: none; outline: none; box-sizing: border-box;">${message.notes || ''}</textarea>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: ${isDarkMode ? '#8899a6' : '#536471'};">Note: Only the first ${NOTES_PREVIEW_LIMIT} characters will be shown in the preview.</p>
            </div>
            <div class="notes-modal-footer" style="padding: 16px; border-top: 1px solid ${isDarkMode ? '#38444d' : '#eff3f4'}; display: flex; justify-content: space-between;">
                <button id="clear-notes" style="background: ${isDarkMode ? '#2d3741' : '#eff3f4'}; border: none; border-radius: 9999px; padding: 8px 16px; cursor: pointer; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-weight: 500; font-size: 14px;">Clear</button>
                <div>
                    <button id="cancel-notes" style="background: ${isDarkMode ? '#2d3741' : '#eff3f4'}; border: none; border-radius: 9999px; padding: 8px 16px; margin-right: 8px; cursor: pointer; color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-weight: 500; font-size: 14px;">Cancel</button>
                    <button id="save-notes" style="background: #1d9bf0; border: none; border-radius: 9999px; padding: 8px 16px; cursor: pointer; color: #ffffff; font-weight: 500; font-size: 14px;">Save</button>
                </div>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Focus the textarea
        document.getElementById('notes-textarea').focus();

        // Add event listeners
        document.getElementById('cancel-notes').addEventListener('click', () => {
            overlay.remove();
        });

        document.getElementById('clear-notes').addEventListener('click', () => {
            document.getElementById('notes-textarea').value = '';
        });

        document.getElementById('save-notes').addEventListener('click', () => {
            const notes = document.getElementById('notes-textarea').value.trim();
            
            // >>> START OF THE FIX <<<
            isUpdatingArchive = true; 
            // >>> END OF THE FIX <<<
            
            chrome.storage.local.get(['archivedMessages'], result => {
                const archivedStorage = result.archivedMessages || []; // Renamed to avoid conflict with outer 'archived'
                const messageIndex = archivedStorage.findIndex(m => m.id === msgId);
                
                if (messageIndex !== -1) {
                    archivedStorage[messageIndex].notes = notes;
                    
                    chrome.storage.local.set({ archivedMessages: archivedStorage }, () => {
                        // >>> START OF THE FIX <<<
                        isUpdatingArchive = false; 
                        // >>> END OF THE FIX <<<
                        
                        overlay.remove();
                        // We still need to refresh the archive panel to show the new/updated note
                        refreshArchiveList(); 
                    });
                } else {
                    // >>> START OF THE FIX <<<
                    // Ensure the flag is cleared even if the message wasn't found
                    // or some other error occurred before setting storage.
                    isUpdatingArchive = false; 
                    // >>> END OF THE FIX <<<
                    console.warn('Message not found in archive for adding notes:', msgId);
                    overlay.remove(); // Still close modal on error
                }
            });
        });

        // Close when clicking outside
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        // Close with ESC key
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
            }
        });
    });
}


function refreshArchiveList() {
    chrome.storage.local.get(['archivedMessages'], result => {
        const archived = result.archivedMessages || [];
        const list = document.getElementById('archiveList');
        if (!list) return;
        list.innerHTML = '';

        // Detect if the site is in dark mode
        const isDarkMode = document.body.classList.contains('night-mode') ||
            document.documentElement.classList.contains('dark') ||
            document.querySelector('html[data-color-mode="dark"]') !== null ||
            (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

        // Filter archived messages based on search query
        const filteredArchived = searchQuery ?
            archived.filter(msg => {
                const username = (msg.username || '').toLowerCase();
                const handle = (msg.handle || '').toLowerCase();
                const content = (msg.messagePreview || '').toLowerCase();
                const notes = (msg.notes || '').toLowerCase();
                const groupName = (msg.groupName || '').toLowerCase();
                // Include group participants in search
                const participantsMatch = msg.participants && msg.participants.some(
                    participant => participant.toLowerCase().includes(searchQuery)
                );
                // Include full group name in search (first line of content)
                const groupContentName = msg.isGroupChat && msg.content ? 
                    msg.content.split('\n')[0].toLowerCase() : '';
                
                return username.includes(searchQuery) ||
                    handle.includes(searchQuery) ||
                    content.includes(searchQuery) ||
                    notes.includes(searchQuery) ||
                    groupName.includes(searchQuery) ||
                    participantsMatch ||
                    (groupContentName && groupContentName.includes(searchQuery));
            }) :
            archived;

        if (filteredArchived.length === 0) {
            list.innerHTML = `<div style="text-align: center; padding: 40px 20px; color: ${isDarkMode ? '#8899a6' : '#536471'}; font-size: 15px;">
                ${searchQuery ? 'No matches found. Try a different search term.' : 'No archived messages'}
            </div>`;
            return;
        }

        // Sort messages by timestamp, respecting the current sort order
        filteredArchived.sort((a, b) => {
            // Use messageTimestamp if available, otherwise use timestamp
            const aTime = a.messageTimestamp ? new Date(a.messageTimestamp) : (a.timestamp ? new Date(a.timestamp) : new Date(0));
            const bTime = b.messageTimestamp ? new Date(b.messageTimestamp) : (b.timestamp ? new Date(b.timestamp) : new Date(0));

            // Sort based on the currentSortOrder
            return currentSortOrder === 'newest' ? (bTime - aTime) : (aTime - bTime);
        });

        // Add scrollbar styling for webkit browsers
        list.style.scrollbarWidth = 'thin';
        list.style.scrollbarColor = isDarkMode ? '#38444d transparent' : '#cfd9de transparent';

        // Add a wrapper for custom scrollbar styling (ensure it's only added once or is idempotent)
        if (!document.getElementById('archiveListScrollbarStyles')) {
            const scrollbarStyles = document.createElement('style');
            scrollbarStyles.id = 'archiveListScrollbarStyles';
            scrollbarStyles.textContent = `
                #archiveList::-webkit-scrollbar {
                    width: 4px;
                }
                #archiveList::-webkit-scrollbar-track {
                    background: transparent;
                }
                #archiveList::-webkit-scrollbar-thumb {
                    background-color: ${isDarkMode ? '#38444d' : '#cfd9de'};
                    border-radius: 4px;
                }
            `;
            document.head.appendChild(scrollbarStyles);
        }


        // Function to get Twitter-style relative time (now, 1m, 5h, etc.) with improved year handling
        function getRelativeTime(timestamp) {
            if (!timestamp) return '1h'; // Fallback

            const now = new Date();
            const messageTime = new Date(timestamp);
            const diffSeconds = Math.floor((now - messageTime) / 1000);
            const diffYears = now.getFullYear() - messageTime.getFullYear();

            // If less than 24 hours, show hours or minutes
            if (diffSeconds < 24 * 60 * 60) {
                if (diffSeconds < 60) return 'now';

                const diffMinutes = Math.floor(diffSeconds / 60);
                if (diffMinutes < 60) return `${diffMinutes}m`;

                const diffHours = Math.floor(diffMinutes / 60);
                return `${diffHours}h`;
            }
            // If more than a year ago, show only month and year
            else if (diffYears > 0) {
                return new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    year: 'numeric'
                }).format(messageTime);
            }
            // If less than a year ago but more than 24 hours, show month and day
            else {
                return new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    day: 'numeric'
                }).format(messageTime);
            }
        }

        filteredArchived.forEach(msg => {
            const msgContainer = document.createElement('div');
            msgContainer.className = 'archived-message';
            msgContainer.style.position = 'relative';
            msgContainer.style.padding = '12px 16px';
            // Adjust height if there are notes
            msgContainer.style.minHeight = '68px';
            msgContainer.style.height = msg.notes ? 'auto' : '68px';
            msgContainer.style.boxSizing = 'border-box';
            msgContainer.style.borderBottom = `1px solid ${isDarkMode ? '#38444d' : '#eff3f4'}`;
            msgContainer.style.backgroundColor = isDarkMode ? '#15202b' : '#ffffff';
            msgContainer.style.transition = 'background-color 0.2s';

            // Check if this message is selected
            const isSelected = selectedMessages.has(msg.id);

            // Handle group chats display
            let groupIndicator = '';
            let highlightedUsername = msg.username || 'User';
            const highlightedHandle = msg.handle || '';

            if (msg.isGroupChat) {
                // Use the stored group name if available
                let groupNameDisplay = msg.groupName || '';
                
                // If no groupName stored (for older archived messages), construct from participants
                if (!groupNameDisplay && msg.participants && msg.participants.length > 0) {
                    if (msg.participants.length === 1) {
                        groupNameDisplay = msg.participants[0];
                    } else if (msg.participants.length === 2) {
                        groupNameDisplay = `${msg.participants[0]} and ${msg.participants[1]}`;
                    } else {
                        // Three or more participants - show first two and "X more"
                        const otherCount = (msg.participantCount > msg.participants.length) ? 
                            msg.participantCount - 2 : msg.participants.length - 2;
                        
                        if (otherCount > 0) {
                            groupNameDisplay = `${msg.participants[0]}, ${msg.participants[1]} and ${otherCount} more`;
                        } else {
                            // Just list all participants without "and X more"
                            groupNameDisplay = msg.participants.join(', ');
                        }
                    }
                } else if (!groupNameDisplay && msg.content) {
                    // Fallback: Use the first line of content if it looks like a group chat header
                    const firstLine = msg.content.split('\n')[0];
                    if (firstLine.includes(',') && firstLine.includes('and')) {
                        groupNameDisplay = firstLine;
                    }
                } else if (!groupNameDisplay) {
                    // Last resort fallback - just show "Group Chat"
                    groupNameDisplay = 'Group Chat';
                }
                
                // Apply highlighting to group name if search is active
                if (searchQuery && groupNameDisplay) {
                    const escapedSearchQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    groupNameDisplay = groupNameDisplay.replace(
                        new RegExp(escapedSearchQuery, 'gi'), 
                        match => `<span style="background-color: ${isDarkMode ? '#1c4563' : '#c1e7ff'}; color: ${isDarkMode ? '#ffffff' : '#0f1419'}">${match}</span>`
                    );
                }
                
                // For group chats, use the group name display instead of the username
                highlightedUsername = groupNameDisplay;
                
                // Add a subtle group indicator badge
                groupIndicator = `<span style="font-size: 12px; padding: 1px 6px; background-color: ${isDarkMode ? '#3E4C5A' : '#E1E8ED'}; color: ${isDarkMode ? '#ffffff' : '#536471'}; border-radius: 9999px; margin-left: 5px;">Group</span>`;
            } else {
                // For individual chats, just highlight the username if search is active
                if (searchQuery) {
                    const escapedSearchQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    highlightedUsername = highlightedUsername.replace(
                        new RegExp(escapedSearchQuery, 'gi'), 
                        match => `<span style="background-color: ${isDarkMode ? '#1c4563' : '#c1e7ff'}; color: ${isDarkMode ? '#ffffff' : '#0f1419'}">${match}</span>`
                    );
                }
            }

            // Get message preview, making sure it doesn't contain the handle
            let messagePreview = msg.messagePreview || 'You accepted the request';

            // Remove any handle from message preview
            if (msg.handle && messagePreview.includes(msg.handle)) {
                messagePreview = messagePreview.replace(msg.handle, '').trim();
            }

            // Remove any @ mentions from the message preview
            messagePreview = messagePreview.replace(/@[A-Za-z0-9_.-]+/g, '').trim();

            // Clean up common Twitter DM text patterns
            messagePreview = messagePreview
                .replace('You accepted the request', 'You accepted the request') // Ensure only one if duplicated
                .replace(/\s+/g, ' ')
                .trim();

            // Clean up timestamps in message preview
            messagePreview = messagePreview.replace(/·\s*\d+[hmd]/g, '').trim();

            // Get relative time from the message timestamp (if available) or archive timestamp
            const timeToUse = msg.messageTimestamp || msg.timestamp;
            const relativeTime = getRelativeTime(timeToUse);

            // Highlight message preview if there's a search query
            let highlightedMessagePreview = messagePreview;
            if (searchQuery) {
                const escapedSearchQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                highlightedMessagePreview = messagePreview.replace(
                    new RegExp(escapedSearchQuery, 'gi'), 
                    match => `<span style="background-color: ${isDarkMode ? '#1c4563' : '#c1e7ff'}; color: ${isDarkMode ? '#ffffff' : '#0f1419'}">${match}</span>`
                );
            }

            // Create the overlapping avatars style
            let avatarHTML = '';

            if (msg.avatarUrls && msg.avatarUrls.length > 0) {
                const numAvatars = Math.min(msg.avatarUrls.length, 4); // Limit to 4 avatars max

                if (!msg.isGroupChat || numAvatars === 1) {
                    // Just a regular circular avatar for single user or group with 1 avatar
                    avatarHTML = `
                        <div style="width: 40px; height: 40px; position: relative;">
                            <div style="width: 40px; height: 40px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'};">
                                <img src="${msg.avatarUrls[0]}" alt="Profile" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                        </div>
                    `;
                } else if (numAvatars === 2) {
                    // Two overlapping circles
                    avatarHTML = `
                        <div style="width: 40px; height: 40px; position: relative;">
                            <div style="width: 30px; height: 30px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; position: absolute; top: 0; left: 0; border: 2px solid ${isDarkMode ? '#15202b' : '#ffffff'}; z-index: 1;">
                                <img src="${msg.avatarUrls[0]}" alt="Profile 1" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                            <div style="width: 30px; height: 30px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; position: absolute; bottom: 0; right: 0; border: 2px solid ${isDarkMode ? '#15202b' : '#ffffff'}; z-index: 0;">
                                <img src="${msg.avatarUrls[1]}" alt="Profile 2" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                        </div>
                    `;
                } else if (numAvatars === 3) {
                    // Three overlapping circles in a triangle
                    avatarHTML = `
                        <div style="width: 40px; height: 40px; position: relative;">
                            <div style="width: 24px; height: 24px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; position: absolute; top: 0; left: 8px; border: 2px solid ${isDarkMode ? '#15202b' : '#ffffff'}; z-index: 2;">
                                <img src="${msg.avatarUrls[0]}" alt="Profile 1" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                            <div style="width: 24px; height: 24px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; position: absolute; bottom: 0; left: 0; border: 2px solid ${isDarkMode ? '#15202b' : '#ffffff'}; z-index: 1;">
                                <img src="${msg.avatarUrls[1]}" alt="Profile 2" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                            <div style="width: 24px; height: 24px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; position: absolute; bottom: 0; right: 0; border: 2px solid ${isDarkMode ? '#15202b' : '#ffffff'}; z-index: 0;">
                                <img src="${msg.avatarUrls[2]}" alt="Profile 3" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                        </div>
                    `;
                } else { // numAvatars === 4
                    // Four overlapping circles
                    avatarHTML = `
                        <div style="width: 40px; height: 40px; position: relative;">
                            <div style="width: 22px; height: 22px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; position: absolute; top: 0; left: 0; border: 2px solid ${isDarkMode ? '#15202b' : '#ffffff'}; z-index: 3;">
                                <img src="${msg.avatarUrls[0]}" alt="Profile 1" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                            <div style="width: 22px; height: 22px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; position: absolute; top: 0; right: 0; border: 2px solid ${isDarkMode ? '#15202b' : '#ffffff'}; z-index: 2;">
                                <img src="${msg.avatarUrls[1]}" alt="Profile 2" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                            <div style="width: 22px; height: 22px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; position: absolute; bottom: 0; left: 0; border: 2px solid ${isDarkMode ? '#15202b' : '#ffffff'}; z-index: 1;">
                                <img src="${msg.avatarUrls[2]}" alt="Profile 3" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                            <div style="width: 22px; height: 22px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; position: absolute; bottom: 0; right: 0; border: 2px solid ${isDarkMode ? '#15202b' : '#ffffff'}; z-index: 0;">
                                <img src="${msg.avatarUrls[3]}" alt="Profile 4" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                            </div>
                        </div>
                    `;
                }
            } else {
                // Fallback for no avatars (e.g., placeholder)
                avatarHTML = `
                    <div style="width: 40px; height: 40px; border-radius: 50%; background-color: ${isDarkMode ? '#2d3741' : '#eff3f4'}; display:flex; align-items:center; justify-content:center; font-size:18px; color:${isDarkMode ? '#8899a6' : '#536471'};">
                        ${msg.username ? msg.username.charAt(0) : '?'}
                    </div>
                `;
            }

            // Format notes with preview limit
            let highlightedNotes = msg.notes || '';
            if (searchQuery && highlightedNotes) {
                const escapedSearchQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                highlightedNotes = highlightedNotes.replace(
                    new RegExp(escapedSearchQuery, 'gi'), 
                    match => `<span style="background-color: ${isDarkMode ? '#1c4563' : '#c1e7ff'}; color: ${isDarkMode ? '#ffffff' : '#0f1419'}">${match}</span>`
                );
            }

            // Notes section HTML
            const notesHTML = msg.notes ? `
                <div class="message-notes" style="margin-top: 4px; padding-left: 52px; color: ${isDarkMode ? '#8899a6' : '#536471'}; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: normal; word-break: break-word;">
                    <span style="color: ${isDarkMode ? '#1d9bf0' : '#1d9bf0'}; font-weight: 500;">Note:</span> ${highlightedNotes.substring(0, NOTES_PREVIEW_LIMIT) + (msg.notes.length > NOTES_PREVIEW_LIMIT ? '...' : '')}
                </div>
            ` : '';


            // Try to recreate the message layout to match the screenshot - using username & May 14 format
            const messageHTML = `
                <div class="message-content" style="display: flex; align-items: flex-start;">
                    <div style="margin-right: 12px; flex-shrink: 0;">
                        ${avatarHTML}
                    </div>
                    
                    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; overflow: hidden;">
                        <div style="display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <span class="message-username" style="color: ${isDarkMode ? '#ffffff' : '#0f1419'}; font-size: 15px; font-weight: 500; overflow: hidden; text-overflow: ellipsis;">
                                ${highlightedUsername} ${highlightedHandle} · ${relativeTime} ${groupIndicator}
                            </span>
                        </div>
                        <div style="margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <span class="message-preview" style="color: ${isDarkMode ? '#8899a6' : '#536471'}; font-size: 14px; overflow: hidden; text-overflow: ellipsis;">
                                ${highlightedMessagePreview}
                            </span>
                        </div>
                    </div>
                    
                    <div style="margin-left: 12px; display: flex; align-items: center; justify-content: center;">
                        <div class="notes-btn" data-msgid="${msg.id}" style="width: 24px; height: 24px; margin-right: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: ${isDarkMode ? '#8899a6' : '#536471'}; transition: color 0.2s ease; position: relative;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                            ${msg.notes ? `<div style="position: absolute; top: -4px; right: -4px; width: 8px; height: 8px; background-color: #1d9bf0; border-radius: 50%;"></div>` : ''}
                        </div>
                        
                        <div class="checkbox-container" style="width: 24px; height: 24px; border-radius: 4px; border: 2px solid ${isSelected ? '#1d9bf0' : (isDarkMode ? '#8899a6' : '#cfd9de')}; background-color: ${isSelected ? '#1d9bf0' : 'transparent'}; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;">
                            ${isSelected ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>` : ''}
                        </div>
                    </div>
                </div>
                
                ${notesHTML}
            `;

            msgContainer.innerHTML = messageHTML;

            // Add hover state for the message container
            msgContainer.addEventListener('mouseenter', () => {
                msgContainer.style.backgroundColor = isDarkMode ? '#1e2732' : '#f7f9f9';
                // Highlight notes button on hover
                const notesBtn = msgContainer.querySelector('.notes-btn');
                if (notesBtn) {
                    notesBtn.style.color = isDarkMode ? '#ffffff' : '#0f1419';
                }
            });

            msgContainer.addEventListener('mouseleave', () => {
                msgContainer.style.backgroundColor = isDarkMode ? '#15202b' : '#ffffff';
                // Reset notes button color
                const notesBtn = msgContainer.querySelector('.notes-btn');
                if (notesBtn) {
                    notesBtn.style.color = isDarkMode ? '#8899a6' : '#536471';
                }
            });

            // Add click handler to the checkbox for selection
            const checkbox = msgContainer.querySelector('.checkbox-container');
            if (checkbox) {
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent message selection when clicking checkbox
                    toggleMessageSelection(msg.id);
                });
            }

            // Add click handler to the notes button
            const notesBtn = msgContainer.querySelector('.notes-btn');
            if (notesBtn) {
                notesBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent message selection
                    showNotesModal(msg.id);
                });

                // Show tooltip on hover
                notesBtn.title = msg.notes ? 'Edit note' : 'Add note';
            }

            // Add click handler to the entire message for selection
            msgContainer.addEventListener('click', (e) => {
                // Check if we clicked on a button or other interactive element
                if (!e.target.closest('.notes-btn') && !e.target.closest('.checkbox-container')) {
                    toggleMessageSelection(msg.id);
                }
            });

            list.appendChild(msgContainer);
        });

        // Update restore button to reflect selections
        updateRestoreButton();
        
        // Update text scaling based on panel size
        updateTextScaling();
    });
}

// Setup the mutation observer to monitor for new messages
function setupObserver() {
    if (xDmArchiverObserverActive) return; // Don't setup twice

    const observer = new MutationObserver(mutations => {
        if (isUpdatingArchive) return;
        const relevant = mutations.some(mutation =>
            Array.from(mutation.addedNodes).some(node =>
                node.nodeType === 1 &&
                (node.matches('[data-testid="conversation"]') ||
                    node.querySelector('[data-testid="conversation"]'))
            )
        );
        if (relevant) safeAddArchiveButtons();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    xDmArchiverObserverActive = true;
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.archivedMessages) {
        if (isUpdatingArchive) return; // This is key to prevent recursion or unwanted calls
        refreshArchiveList();
        forceRefreshMessageVisibility();
    }
});

// Apply some global styles
const style = document.createElement('style');
style.textContent = `
    #archivePanel {
        font-family: "TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        resize: none; /* Disable default resize behavior since we're implementing our own */
    }
    
    #resizeHandle {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 16px;
        height: 16px;
        cursor: nwse-resize;
        display: flex;
        justify-content: flex-end;
        align-items: flex-end;
        z-index: 10;
    }
    
    .restore-selected-btn {
        opacity: 1;
        transition: background-color 0.2s, color 0.2s;
    }
    
    .restore-selected-btn:not([disabled]):hover {
        background-color: #1a8cd8 !important;
        color: white !important;
    }
    
    .archive-btn:hover {
        background-color: #1a8cd8 !important;
    }
    
    .sort-btn {
        transition: background-color 0.2s, color 0.2s;
    }
    
    .sort-btn.active {
        /* Styles for active sort button are handled inline for simplicity with dark mode */
    }
    
    .sort-btn:not(.active):hover { /* Style for non-active hover */
        background-color: #1a8cd8 !important;
        color: white !important;
    }
    
    .drag-handle {
        cursor: move;
        user-select: none;
    }
    
    #archiveHeader {
        user-select: none;
    }
    
    .checkbox-container {
        transition: all 0.2s ease;
    }
    
    .checkbox-container:hover {
        border-color: #1d9bf0 !important;
    }
    
    .archived-message {
        cursor: pointer;
    }
`;
document.head.appendChild(style);

function injectMiniDrawerArchiveButton() {
    const observer = new MutationObserver(() => {
        // Prevent injection on the main /messages page
        if (window.location.pathname.startsWith('/messages')) return;

        const actionBar = document.querySelector('div.css-175oi2r.r-1pz39u2.r-1777fci.r-15ysp7h.r-obd0qt.r-s8bhmr > div');

        if (!actionBar || document.getElementById('archiveListMiniBtn')) return;

        const archiveBtn = document.createElement('button');
        archiveBtn.id = 'archiveListMiniBtn';
        archiveBtn.title = 'Open Archive Panel';
        archiveBtn.innerHTML = `
            <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;">
                <g><path d="M19.9 23.5c-.2 0-.3 0-.4-.1L12 17.9l-7.5 5.4c-.2.2-.5.2-.8.1-.2-.1-.4-.4-.4-.7V5.6c0-1.2 1-2.2 2.2-2.2h12.8c1.2 0 2.2 1 2.2 2.2v17.1c0 .3-.2.5-.4.7 0 .1-.1.1-.2.1z"></path></g>
            </svg>
        `;
        archiveBtn.style.border = 'none';
        archiveBtn.style.background = 'none';
        archiveBtn.style.cursor = 'pointer';
        archiveBtn.style.borderRadius = '50%';
        archiveBtn.style.width = '36px';
        archiveBtn.style.height = '36px';
        archiveBtn.style.display = 'flex';
        archiveBtn.style.alignItems = 'center';
        archiveBtn.style.justifyContent = 'center';
        archiveBtn.style.marginRight = '8px';

        // Hover feedback
        archiveBtn.addEventListener('mouseenter', () => {
            archiveBtn.style.backgroundColor = 'rgba(29, 155, 240, 0.1)';
        });
        archiveBtn.addEventListener('mouseleave', () => {
            archiveBtn.style.backgroundColor = 'transparent';
        });

        archiveBtn.onclick = toggleArchivePanel;

        const newMessageBtn = actionBar.querySelector('button:nth-child(1)');
        if (newMessageBtn) {
            actionBar.insertBefore(archiveBtn, newMessageBtn);
        } else {
            actionBar.appendChild(archiveBtn);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}


// Function to initialize on page load or navigation
function initializeOnNavigation() {
    // Run on any Twitter/X page, not just messages
    if (window.location.hostname.includes('x.com') || 
        window.location.hostname.includes('twitter.com')) {
        // Delay to allow Twitter's SPA to fully load components
        setTimeout(() => {
            addArchiveButtons();
            injectArchiveButton();
            injectMiniDrawerArchiveButton();
            setupObserver();
            forceRefreshMessageVisibility(); // Ensure visibility is correct on init

            // Also notify the background script if needed
            // chrome.runtime.sendMessage({ type: 'initializeArchiver' });
        }, 500);
    }
}

// Listen for URL changes (for SPA navigation)
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        // Reset processed messages on navigation to allow re-adding buttons if elements are new
        processedMessages = new WeakSet(); 
        initializeOnNavigation();
    }
});

// Add this new helper function near getMessageId
function cleanTextForId(text) {
    if (!text) return '';
    let cleaned = text;

    // Remove common timestamp patterns like "· 1h", "· 2m", "· May 14", "· May 14, 2023"
    // Regex tries to capture various Twitter/X time formats.
    // It looks for the dot separator "·" followed by numbers with h/m/d/s or month-day(-year) formats.
    cleaned = cleaned.replace(/·\s*(\d+[hmds]|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,\s*\d{4}|(?!\s*,))?)/g, '');

    // Remove standalone time patterns if not preceded by "·" (less common in DMs list but good for robustness)
    cleaned = cleaned.replace(/\b(\d+[hmds]|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,\s*\d{4}|(?!\s*,))?)(?=\s|$)/g, '');


    // Normalize multiple spaces to a single space and trim
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

// Start observing URL changes
urlObserver.observe(document, { subtree: true, childList: true });

// Initialize on page load
// Using a self-invoking function to ensure DOM is ready, or wait if not.
(function() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeOnNavigation);
    } else {
        // DOMContentLoaded has already fired
        initializeOnNavigation();
    }
})();
