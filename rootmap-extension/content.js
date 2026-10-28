(() => {
  // Grab league name
  const leagueNameEl = document.querySelector('.LeagueHeader-leagueName') || 
                       document.querySelector('#nav-league-title') ||
                       document.querySelector('title');
  const leagueName = leagueNameEl ? leagueNameEl.innerText.split('|')[0].trim() : "Yahoo League";

  // Matchup tables container on Yahoo Fantasy
  const matchupContainer = document.querySelector('#matchup') || 
                           document.querySelector('#matchups') || 
                           document.querySelector('#stat-table1')?.closest('.Grid-table') ||
                           document.querySelector('.matchup-detail') ||
                           document.body;

  const rawText = matchupContainer ? matchupContainer.innerText : "";

  // Perform clipboard copy right inside the Yahoo page
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
    console.error("Clipboard copy failed inside page context", err);
  }

  return {
    leagueName,
    rawText,
    charCount: rawText.length
  };
})();