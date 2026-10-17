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
  switch (eventType) {
    // Offensive actions
    case 'RUSH_10YD': return 1.0;
    case 'REC_15YD': return 2.5;
    case 'TOUCHDOWN': return 6.0;
    case 'TURNOVER': return -2.0;

    // IDP / Defensive actions
    case 'IDP_SOLO_TACKLE': return 1.5;
    case 'IDP_TFL': return 2.0;
    case 'IDP_SACK': return 4.0;
    case 'IDP_INT': return 5.0;

    default: return 0.0;
  }
}