export function calculatePlayerLeverage(leagueDetails = []) {
    let startedCount = 0;
    let opponentCount = 0;
  
    if (leagueDetails && leagueDetails.length) {
      leagueDetails.forEach((item) => {
        if (item.status === 'STARTER') startedCount++;
        if (item.status === 'OPPONENT') opponentCount++;
      });
    }
  
    const netMultiplier = +(startedCount - opponentCount).toFixed(1);
  
    let label = "0.0x Neutral";
    let color = "gray";
  
    if (netMultiplier > 0) {
      label = "+" + netMultiplier + "x Net Long";
      color = "green";
    } else if (netMultiplier < 0) {
      label = netMultiplier + "x Net Short";
      color = "red";
    }
  
    return {
      netMultiplier: netMultiplier,
      startedCount: startedCount,
      opponentCount: opponentCount,
      neutralCount: 0,
      label: label,
      color: color
    };
  }
  
  export function calculatePlayBasePoints(eventType) {
    if (eventType === 'RUSH_10YD') return 1.0;
    if (eventType === 'REC_15YD') return 2.5;
    if (eventType === 'TOUCHDOWN') return 6.0;
    if (eventType === 'TURNOVER') return -2.0;
    return 0.0;
  }