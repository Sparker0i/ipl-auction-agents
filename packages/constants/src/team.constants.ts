export const IPL_TEAMS = {
  RCB: 'Royal Challengers Bangalore',
  CSK: 'Chennai Super Kings',
  MI: 'Mumbai Indians',
  KKR: 'Kolkata Knight Riders',
  DC: 'Delhi Capitals',
  RR: 'Rajasthan Royals',
  PBKS: 'Punjab Kings',
  SRH: 'Sunrisers Hyderabad',
  GT: 'Gujarat Titans',
  LSG: 'Lucknow Super Giants',
} as const;

export const TEAM_RETENTIONS = {
  RCB: { retentionCostCr: 37, rtmCards: 1 },
  RR: { retentionCostCr: 89, rtmCards: 0 },
  CSK: { retentionCostCr: 66, rtmCards: 0 },
  KKR: { retentionCostCr: 57, rtmCards: 0 },
  PBKS: { retentionCostCr: 9.5, rtmCards: 2 },
  DC: { retentionCostCr: 47, rtmCards: 1 },
  LSG: { retentionCostCr: 51, rtmCards: 1 },
  SRH: { retentionCostCr: 75, rtmCards: 0 },
  GT: { retentionCostCr: 51, rtmCards: 1 },
  MI: { retentionCostCr: 75, rtmCards: 0 },
} as const;

export const TEAM_CONSTRAINTS = {
  MIN_PLAYERS: 18,
  MAX_PLAYERS: 25,
  MAX_OVERSEAS: 8,
  BASE_PURSE_CR: 120,
} as const;
