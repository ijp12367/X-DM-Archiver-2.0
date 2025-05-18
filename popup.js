// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const archiveList = document.getElementById('archiveList');
  const clearBtn = document.getElementById('clearArchive');

  chrome.runtime.sendMessage({ type: 'getArchived' }, (response) => {
    response.archived.forEach((msg, index) => {
      const li = document.createElement('li');
      li.textContent = msg.content;
      const restoreBtn = document.createElement('button');
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', () => restoreMessage(index));
      li.appendChild(restoreBtn);
      archiveList.appendChild(li);
    });
  });

  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'clearArchive' }, () => {
      archiveList.innerHTML = '';
    });
  });
});

function restoreMessage(index) {
  chrome.storage.local.get(['archivedMessages'], (result) => {
    const archived = result.archivedMessages || [];
    const [restored] = archived.splice(index, 1);
    chrome.storage.local.set({ archivedMessages: archived }, () => {
      // Optionally, send a message to content.js to unhide the message
      // For now, just reload the popup
      location.reload();
    });
  });
}
