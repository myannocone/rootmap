/**
 * Roster slot normalization and eligibility mapper
 */
export const ROSTER_SLOTS = {
    QB: { label: 'QB', category: 'OFFENSE' },
    RB: { label: 'RB', category: 'OFFENSE' },
    WR: { label: 'WR', category: 'OFFENSE' },
    TE: { label: 'TE', category: 'OFFENSE' },
    FLEX: { label: 'W/R/T', category: 'FLEX' },
    SUPERFLEX: { label: 'Q/W/R/T', category: 'SUPERFLEX' },
    DL: { label: 'DL', category: 'IDP' },
    LB: { label: 'LB', category: 'IDP' },
    DB: { label: 'DB', category: 'IDP' },
    IDP_FLEX: { label: 'IDP FLEX', category: 'IDP' },
    K: { label: 'K', category: 'SPECIAL' },
    DEF: { label: 'D/ST', category: 'TEAM_DEF' },
    BENCH: { label: 'BN', category: 'INACTIVE' },
    IR: { label: 'IR', category: 'INACTIVE' }
  };
  
  export function isStarterSlot(slotKey) {
    const slot = ROSTER_SLOTS[slotKey] || { category: 'OFFENSE' };
    return slot.category !== 'INACTIVE';
  }
  
  /**
   * Standard IDP + Offensive Play Scoring Engine
   */
  export function calculateExpandedPlayPoints(eventType) {
    switch (eventType) {
      // Offensive
      case 'RUSH_10YD': return 1.0;
      case 'REC_15YD': return 2.5;
      case 'TOUCHDOWN': return 6.0;
      case 'TURNOVER': return -2.0;
  
      // IDP / Defensive
      case 'IDP_SOLO_TACKLE': return 1.5;
      case 'IDP_SACK': return 4.0;
      case 'IDP_INT': return 5.0;
      case 'IDP_TFL': return 2.0;
  
      default: return 0.0;
    }
  }