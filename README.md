# Twitter DM Archive

A Chrome extension that helps you organize and manage your Twitter/X Direct Messages by allowing you to archive conversations and easily restore them when needed.

![Twitter DM Archive Extension](https://github.com/ijp12367/x-dm-archiver/blob/main/icons/icon128.png?raw=true)

## Features

- **Archive Messages**: Hide conversations from your DM list without deleting them
- **Multi-Select Restoration**: Select multiple conversations and restore them at once
- **Message Notes**: Add personal notes to archived messages for future reference
- **Group Chat Support**: Special handling for group conversations with multiple avatars
- **Import/Export**: Save and restore your archived messages between devices
- **Resizable Panel**: Customize the size of your archive panel to fit your needs
- **Search Functionality**: Easily find specific archived messages by name, content, or notes
- **Sort Options**: Sort your archived messages by newest or oldest
- **Drag & Drop**: Position the archive panel anywhere on your screen
- **Dark Mode Support**: Automatically adapts to Twitter's light or dark mode
- **Position Memory**: Remembers where you placed the archive panel between sessions

## Installation

### From Chrome Web Store (Recommended)
1. Visit the Chrome Web Store (link to be added when published)
2. Click "Add to Chrome"
3. Confirm the installation

### Manual Installation (Developer Mode)
1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the directory containing the extension files
5. The extension should now be installed and active

## Usage

### Archiving Messages
1. Hover over any conversation in your Twitter DM list
2. Click the 📥 (inbox) button that appears in the bottom-right corner of the conversation
3. The conversation will be archived and hidden from view

### Accessing Archived Messages
1. Click the bookmark icon in the Twitter navigation bar (appears next to the settings icon)
2. The Archive Panel will open, displaying all archived conversations

### Managing Archived Messages
- **Search**: Use the search bar to find specific messages by username, handle, message content, or notes
- **Sort**: Toggle between "Newest" and "Oldest" to change the sort order
- **Select Messages**: Click on a message or its checkbox to select it for restoration
- **Restore Messages**: Select multiple messages to restore and click the "Restore" button.
- **Add Notes**: Click the pencil icon next to any message to add or edit notes
- **Clear All**: Remove all archived messages by clicking "Clear All" (confirmation required)
- **Import/Export**: Save your archive to a file or restore from a previously saved backup

### Panel Customization
- **Move Panel**: Drag the panel using the ☰ (handle) at the top-left to position it anywhere on screen
- **Resize Panel**: Drag the bottom-right corner to resize the panel to your preferred dimensions
- **Close Panel**: Click "Close" to hide the panel (your archives remain saved)

## Technical Details

- The extension uses Chrome's storage API to save archived messages locally in your browser
- No data is sent to external servers; everything is stored on your device
- Messages are archived with their content, username, timestamp, and avatar (when available)
- The extension automatically adapts to Twitter's layout and theme changes
- Group conversations support multiple participant avatars and names
- Notes are stored with each message and can be searched

## Privacy

This extension:
- Does not collect or transmit any user data
- Stores archived messages locally in your browser using Chrome's storage API
- Does not modify or interfere with Twitter's functionality beyond adding archive capabilities
- Requires only minimal permissions necessary for its functionality

## Troubleshooting

If the archive buttons don't appear:
1. Refresh the Twitter page
2. Close and reopen the Archive Panel
3. If problems persist, try reinstalling the extension

If archived messages don't disappear or reappear properly:
1. Click the restore button and then refresh the page
2. If messages still aren't visible, refresh Twitter completely

## Import/Export

To backup your archived messages:
1. Open the Archive Panel
2. Click "Export" to download a JSON file containing all your archived messages

To restore from a backup:
1. Open the Archive Panel
2. Click "Import" and select your previously exported JSON file
3. Choose whether to merge with existing archives or replace them
