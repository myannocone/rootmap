document.addEventListener('DOMContentLoaded', () => {
    const syncBtn = document.getElementById('syncBtn');
    const status = document.getElementById('status');
    const output = document.getElementById('output');
  
    syncBtn.addEventListener('click', async () => {
      status.style.color = '#38bdf8';
      status.innerText = "Extracting matchup data...";
  
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
        if (!tab || !tab.url || (!tab.url.includes("fantasysports.yahoo.com") && !tab.url.includes("fantasy.espn.com"))) {
          status.style.color = '#f87171';
          status.innerText = "Please open a Yahoo or ESPN matchup tab first.";
          return;
        }
  
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }, (results) => {
          if (!results || !results[0] || !results[0].result) {
            status.style.color = '#f87171';
            status.innerText = "Could not read page matchup data.";
            return;
          }
  
          const data = results[0].result;
  
          if (!data.rawText || data.charCount === 0) {
            status.style.color = '#f87171';
            status.innerText = `Found ${data.platform} page, but table was empty.`;
            return;
          }
  
          // Display in textarea as backup
          output.value = data.rawText;
          output.style.display = 'block';
          output.select();
  
          // Write directly to clipboard
          navigator.clipboard.writeText(data.rawText).then(() => {
            status.style.color = '#4ade80';
            status.innerHTML = `✓ Copied <strong>${data.leagueName}</strong> (${data.platform})!<br>Paste into RootMap.`;
          }).catch(() => {
            status.style.color = '#38bdf8';
            status.innerHTML = `✓ Extracted <strong>${data.leagueName}</strong>!<br>Press Ctrl+C below, then paste into RootMap.`;
          });
        });
      } catch (err) {
        status.style.color = '#f87171';
        status.innerText = "Error: " + err.message;
      }
    });
  });