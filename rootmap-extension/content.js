(() => {
  const isEspn = window.location.hostname.includes("espn.com");
  let leagueName = "Fantasy League";
  let rawText = "";

  if (isEspn) {
    // League Name
    const titleEl = document.querySelector('.league-name') || 
                    document.querySelector('.header__league-name') || 
                    document.querySelector('.page-container h1') ||
                    document.querySelector('title');
    leagueName = titleEl ? titleEl.innerText.split('|')[0].trim() : "ESPN League";

    // Grab the entire main page content container so NO sub-tables (IDP, K, DST, Opponent) get left behind
    const espnMain = document.querySelector('#espn-analytics') ||
                     document.querySelector('.layout__column--main') ||
                     document.querySelector('main') ||
                     document.querySelector('.page-container') ||
                     document.body;

    rawText = espnMain ? espnMain.innerText : "";
  } else {
    // Yahoo
    const leagueNameEl = document.querySelector('.LeagueHeader-leagueName') || 
                         document.querySelector('#nav-league-title') || 
                         document.querySelector('title');
    leagueName = leagueNameEl ? leagueNameEl.innerText.split('|')[0].trim() : "Yahoo League";

    const matchupContainer = document.querySelector('#matchup') || 
                             document.querySelector('#matchups') || 
                             document.querySelector('#stat-table1')?.closest('.Grid-table') ||
                             document.querySelector('.matchup-detail') ||
                             document.body;
    rawText = matchupContainer ? matchupContainer.innerText : "";
  }

  // Copy to clipboard in page context
  try {
    const textarea = document.createElement("textarea");
    textarea.value = rawText;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  } catch (err) {
    console.error("Clipboard copy failed", err);
  }

  return {
    leagueName,
    rawText,
    charCount: rawText.length,
    platform: isEspn ? "ESPN" : "Yahoo"
  };
})();