import { TeamCode } from '../types/agent.types.js';
import { TeamStrategy } from '../types/strategy.types.js';

/**
 * Team-specific auction strategies for all 10 IPL franchises
 *
 * Each team has a distinct philosophy and approach based on their
 * historical auction patterns and playing style.
 */
export const TEAM_STRATEGIES: Record<TeamCode, TeamStrategy> = {
  /**
   * Chennai Super Kings - "Experience Matters"
   * Known for: Backing experienced players, value buys, consistent squad
   */
  CSK: {
    teamCode: 'CSK',
    teamName: 'Chennai Super Kings',
    homeVenue: 'MA Chidambaram Stadium',
    aggression: 'balanced',
    riskTolerance: 0.6,
    priorities: {
      experience: 0.8,
      youth: 0.3,
      starPower: 0.6,
      value: 0.9,
    },
    roleDistribution: {
      batters: 40,
      bowlers: 35,
      allRounders: 20,
      wicketkeepers: 5,
    },
    specialRules: {
      maxBidPerPlayer: 18,
      retainedPlayers: [
        'Ruturaj Gaikwad',
        'Ravindra Jadeja',
        'Shivam Dube',
        'Matheesha Pathirana',
        'MS Dhoni',
      ],
      preferredNationalities: ['India', 'South Africa', 'West Indies'],
    },
    philosophy:
      'Prefer experienced players who understand pressure situations. Value solid performers over flashy stars. Build a balanced squad with strong spin options for Chennai pitch.',
  },

  /**
   * Mumbai Indians - "Star Power"
   * Known for: Aggressive bidding, marquee signings, winning mentality
   */
  MI: {
    teamCode: 'MI',
    teamName: 'Mumbai Indians',
    homeVenue: 'Wankhede Stadium',
    aggression: 'aggressive',
    riskTolerance: 0.8,
    priorities: {
      experience: 0.5,
      youth: 0.6,
      starPower: 0.9,
      value: 0.5,
    },
    roleDistribution: {
      batters: 40,
      bowlers: 30,
      allRounders: 20,
      wicketkeepers: 10,
    },
    specialRules: {
      maxBidPerPlayer: 25,
      retainedPlayers: [
        'Jasprit Bumrah',
        'Suryakumar Yadav',
        'Hardik Pandya',
        'Rohit Sharma',
        'Tilak Varma',
      ],
      rivalryBonus: {
        CSK: 1.1, // Willing to pay 10% more for CSK targets
      },
    },
    philosophy:
      'Go for match-winners and proven performers. Not afraid to spend big on game-changers. Prefer versatile all-rounders and death bowling specialists.',
  },

  /**
   * Royal Challengers Bangalore - "Entertainers"
   * Known for: Big spending, star batters, aggressive approach
   */
  RCB: {
    teamCode: 'RCB',
    teamName: 'Royal Challengers Bangalore',
    aggression: 'aggressive',
    homeVenue: 'M Chinnaswamy Stadium',
    riskTolerance: 0.9,
    priorities: {
      experience: 0.6,
      youth: 0.4,
      starPower: 1.0,
      value: 0.3,
    },
    roleDistribution: {
      batters: 45,
      bowlers: 30,
      allRounders: 15,
      wicketkeepers: 10,
    },
    specialRules: {
      maxBidPerPlayer: 30,
      retainedPlayers: ['Virat Kohli', 'Rajat Patidar', 'Yash Dayal'],
    },
    philosophy:
      'Build batting firepower for high-scoring Chinnaswamy. Willing to overpay for marquee players. Need death bowling and spin options urgently.',
  },

  /**
   * Delhi Capitals - "Youth Movement"
   * Known for: Backing young talent, balanced approach, smart buys
   */
  DC: {
    teamCode: 'DC',
    teamName: 'Delhi Capitals',
    homeVenue: 'Arun Jaitley Stadium',
    aggression: 'balanced',
    riskTolerance: 0.7,
    priorities: {
      experience: 0.4,
      youth: 0.8,
      starPower: 0.6,
      value: 0.7,
    },
    roleDistribution: {
      batters: 38,
      bowlers: 35,
      allRounders: 20,
      wicketkeepers: 7,
    },
    specialRules: {
      maxBidPerPlayer: 20,
      retainedPlayers: ['Axar Patel', 'Kuldeep Yadav', 'Tristan Stubbs', 'Abhishek Porel'],
      preferredNationalities: ['India', 'Australia', 'South Africa'],
    },
    philosophy:
      'Invest in young Indian talent with long-term potential. Build around solid domestic core. Look for value picks in uncapped players.',
  },

  /**
   * Punjab Kings - "Aggressive Rebuilders"
   * Known for: Big bids, frequent changes, unorthodox picks
   */
  PBKS: {
    teamCode: 'PBKS',
    teamName: 'Punjab Kings',
    homeVenue: 'IS Bindra Stadium',
    aggression: 'aggressive',
    riskTolerance: 0.85,
    priorities: {
      experience: 0.5,
      youth: 0.6,
      starPower: 0.8,
      value: 0.5,
    },
    roleDistribution: {
      batters: 42,
      bowlers: 32,
      allRounders: 18,
      wicketkeepers: 8,
    },
    specialRules: {
      maxBidPerPlayer: 26,
      retainedPlayers: ['Shashank Singh', 'Prabhsimran Singh'],
    },
    philosophy:
      'Willing to take risks on explosive players. Need strong Indian pace bowling. Look for power hitters suited to flat Mohali pitch.',
  },

  /**
   * Rajasthan Royals - "Moneyball Approach"
   * Known for: Smart analytics, finding gems, value focus
   */
  RR: {
    teamCode: 'RR',
    teamName: 'Rajasthan Royals',
    homeVenue: 'Sawai Mansingh Stadium',
    aggression: 'conservative',
    riskTolerance: 0.55,
    priorities: {
      experience: 0.5,
      youth: 0.7,
      starPower: 0.5,
      value: 0.9,
    },
    roleDistribution: {
      batters: 38,
      bowlers: 35,
      allRounders: 20,
      wicketkeepers: 7,
    },
    specialRules: {
      maxBidPerPlayer: 16,
      retainedPlayers: ['Sanju Samson', 'Yashasvi Jaiswal', 'Riyan Parag', 'Dhruv Jurel', 'Shimron Hetmyer', 'Sandeep Sharma'],
      preferredNationalities: ['India', 'West Indies'],
    },
    philosophy:
      'Find undervalued players through analytics. Focus on strike rate and economy rate metrics. Build depth rather than star power.',
  },

  /**
   * Kolkata Knight Riders - "Balanced Winners"
   * Known for: Strategic buys, mystery spinners, strong domestic core
   */
  KKR: {
    teamCode: 'KKR',
    teamName: 'Kolkata Knight Riders',
    homeVenue: 'Eden Gardens',
    aggression: 'balanced',
    riskTolerance: 0.65,
    priorities: {
      experience: 0.6,
      youth: 0.5,
      starPower: 0.7,
      value: 0.7,
    },
    roleDistribution: {
      batters: 38,
      bowlers: 35,
      allRounders: 20,
      wicketkeepers: 7,
    },
    specialRules: {
      maxBidPerPlayer: 20,
      retainedPlayers: [
        'Rinku Singh',
        'Varun Chakaravarthy',
        'Sunil Narine',
        'Andre Russell',
        'Harshit Rana',
        'Ramandeep Singh',
      ],
      preferredNationalities: ['India', 'West Indies', 'Afghanistan'],
    },
    philosophy:
      'Prefer mystery spinners and power-hitting all-rounders. Strong domestic core. Look for players who can adapt to slow Eden Gardens pitch.',
  },

  /**
   * Lucknow Super Giants - "New Money"
   * Known for: Deep pockets, marquee signings, building identity
   */
  LSG: {
    teamCode: 'LSG',
    teamName: 'Lucknow Super Giants',
    homeVenue: 'Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium',
    aggression: 'aggressive',
    riskTolerance: 0.75,
    priorities: {
      experience: 0.6,
      youth: 0.5,
      starPower: 0.8,
      value: 0.6,
    },
    roleDistribution: {
      batters: 40,
      bowlers: 33,
      allRounders: 20,
      wicketkeepers: 7,
    },
    specialRules: {
      maxBidPerPlayer: 23,
      retainedPlayers: ['Nicholas Pooran', 'Ravi Bishnoi', 'Mayank Yadav', 'Mohsin Khan', 'Ayush Badoni'],
    },
    philosophy:
      'Build a competitive squad quickly with proven performers. Need strong Indian pace attack. Look for explosive middle-order batters.',
  },

  /**
   * Sunrisers Hyderabad - "Orange Army"
   * Known for: Strong bowling, tactical approach, emerging talent
   */
  SRH: {
    teamCode: 'SRH',
    teamName: 'Sunrisers Hyderabad',
    homeVenue: 'Rajiv Gandhi International Cricket Stadium',
    aggression: 'balanced',
    riskTolerance: 0.6,
    priorities: {
      experience: 0.5,
      youth: 0.6,
      starPower: 0.6,
      value: 0.8,
    },
    roleDistribution: {
      batters: 38,
      bowlers: 37,
      allRounders: 18,
      wicketkeepers: 7,
    },
    specialRules: {
      maxBidPerPlayer: 18,
      retainedPlayers: ['Pat Cummins', 'Abhishek Sharma', 'Travis Head', 'Nitish Kumar Reddy', 'Heinrich Klaasen'],
    },
    philosophy:
      'Bowling-first approach with strong pace attack. Look for quality spinners. Need explosive openers to capitalize on powerplay.',
  },

  /**
   * Gujarat Titans - "Champions Mentality"
   * Known for: Smart buys, team chemistry, uncapped talent
   */
  GT: {
    teamCode: 'GT',
    teamName: 'Gujarat Titans',
    homeVenue: 'Narendra Modi Stadium',
    aggression: 'conservative',
    riskTolerance: 0.58,
    priorities: {
      experience: 0.5,
      youth: 0.7,
      starPower: 0.6,
      value: 0.85,
    },
    roleDistribution: {
      batters: 38,
      bowlers: 35,
      allRounders: 20,
      wicketkeepers: 7,
    },
    specialRules: {
      maxBidPerPlayer: 18,
      retainedPlayers: ['Rashid Khan', 'Shubman Gill', 'Sai Sudharsan', 'Rahul Tewatia', 'Shahrukh Khan'],
      preferredNationalities: ['India', 'Afghanistan'],
    },
    philosophy:
      'Focus on team balance over individual stars. Strong domestic talent with quality overseas all-rounders. Need death bowling specialists.',
  },
};

/**
 * Get strategy for a specific team
 */
export function getTeamStrategy(teamCode: TeamCode): TeamStrategy {
  const strategy = TEAM_STRATEGIES[teamCode];
  if (!strategy) {
    throw new Error(`Strategy not found for team: ${teamCode}`);
  }
  return strategy;
}

/**
 * Get all team strategies
 */
export function getAllStrategies(): TeamStrategy[] {
  return Object.values(TEAM_STRATEGIES);
}
