document.addEventListener('DOMContentLoaded', () => {
    const syncBtn = document.getElementById('syncBtn');
    const status = document.getElementById('status');
    const output = document.getElementById('output');
  
    syncBtn.addEventListener('click', async () => {
      status.style.color = '#38bdf8';
      status.innerText = "Extracting matchup data...";
  
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
        if (!tab || !tab.url || !tab.url.includes("fantasysports.yahoo.com")) {
          status.style.color = '#f87171';
          status.innerText = "Please open your Yahoo Matchup tab first.";
          return;
        }
  
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }, (results) => {
          if (!results || !results[0] || !results[0].result) {
            status.style.color = '#f87171';
            status.innerText = "Could not read matchup table.";
            return;
          }
  
          const data = results[0].result;
  
          if (!data.rawText || data.charCount === 0) {
            status.style.color = '#f87171';
            status.innerText = "Matchup table was empty.";
            return;
          }
  
          // Display in popup textbox
          output.value = data.rawText;
          output.style.display = 'block';
          output.select();
  
          // Write directly to clipboard
          navigator.clipboard.writeText(data.rawText).then(() => {
            status.style.color = '#4ade80';
            status.innerHTML = `✓ Copied <strong>${data.leagueName}</strong> (${data.charCount} chars)!<br>Paste directly into RootMap.`;
          }).catch(() => {
            status.style.color = '#38bdf8';
            status.innerHTML = `✓ Extracted <strong>${data.leagueName}</strong>!<br>Press Ctrl+C on the box below, then paste into RootMap.`;
          });
        });
      } catch (err) {
        status.style.color = '#f87171';
        status.innerText = "Error: " + err.message;
      }
    });
  });