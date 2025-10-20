import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { auctionApi, sessionApi } from '../services/api';
import socketService from '../services/socket';
import {
  setAuction,
  setCurrentRound,
  setCurrentSet,
  addBidToHistory,
  clearBidHistory,
  setRTMState,
  clearRTMState,
} from '../store/slices/auctionSlice';
import { setTeams, updateTeamPurse, updateTeamCounts, updateTeamRTM, setMyTeamId } from '../store/slices/teamsSlice';
import { setCurrentPlayer, setCurrentBid } from '../store/slices/playersSlice';
import {
  selectCurrentPlayer,
  selectCurrentBid,
  selectAllTeams,
  selectMyTeam,
  selectBidHistory,
  selectRTMState,
} from '../store/selectors';
import type { RootState } from '../store';

const BID_INCREMENTS = [
  { min: 30, max: 100, increment: 5 },
  { min: 100, max: 200, increment: 10 },
  { min: 200, max: 500, increment: 20 },
  { min: 500, max: Infinity, increment: 25 },
];

const getNextBidIncrement = (currentBid: number): number => {
  const rule = BID_INCREMENTS.find((r) => currentBid >= r.min && currentBid < r.max);
  return rule?.increment || 25;
};

export default function AuctionPage() {
  const { auctionId } = useParams<{ auctionId: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Redux state
  const currentPlayer = useSelector(selectCurrentPlayer);
  const currentBidState = useSelector(selectCurrentBid);
  const teams = useSelector(selectAllTeams);
  const myTeam = useSelector(selectMyTeam);
  const bidHistory = useSelector(selectBidHistory);
  const rtmState = useSelector(selectRTMState);
  const auctionState = useSelector((state: RootState) => state.auction);

  // Local state
  const [_auction, setLocalAuction] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bidding, setBidding] = useState(false);
  const [roundCompleteMessage, setRoundCompleteMessage] = useState<string | null>(null);
  const [showPlayerModal, setShowPlayerModal] = useState(false);
  const [ar1Players, setAr1Players] = useState<any[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'auction' | 'pool' | 'squads'>('auction');
  const [poolData, setPoolData] = useState<{sold: any[], pending: any[], unsold: any[]}>({sold: [], pending: [], unsold: []});
  const [squadsData, setSquadsData] = useState<any[]>([]);
  const [isAuctionEnded, setIsAuctionEnded] = useState(false);
  const [isAR1Complete, setIsAR1Complete] = useState(false);

  const sessionId = sessionApi.getSessionId();
  const myTeamId = auctionId ? sessionApi.getTeamId(auctionId) : null;
  const isAdmin = auctionId ? sessionApi.isAdmin(auctionId) : false;
  const adminToken = auctionId ? sessionApi.getAdminToken(auctionId) : null;

  const bidHistoryRef = useRef<HTMLDivElement>(null);

  // Fetch initial auction data
  useEffect(() => {
    if (!auctionId) return;

    const fetchAuction = async () => {
      try {
        const data = await auctionApi.getAuction(auctionId);
        setLocalAuction(data);

        // Check if auction is already completed
        if (data.status === 'completed') {
          setIsAuctionEnded(true);
          setActiveTab('squads');
        }

        // Update Redux store
        dispatch(
          setAuction({
            id: data.id,
            name: data.name,
            status: data.status,
            currentRound: data.currentRound,
            currentSet: data.currentSet,
            roomCode: data.roomCode,
          })
        );

        dispatch(setTeams(data.teams || []));

        // Set my team ID in Redux if we have one
        if (myTeamId) {
          dispatch(setMyTeamId(myTeamId));
        }

        // Clear RTM state on initial load (but keep bid history)
        dispatch(clearRTMState());

        if (data.currentPlayer) {
          dispatch(setCurrentPlayer(data.currentPlayer));
          // Use current bid from backend - keep null if no bids yet
          // Only use backend value if it's explicitly a number, otherwise null
          dispatch(
            setCurrentBid({
              playerId: data.currentPlayer.id,
              currentBidLakh: typeof data.currentBidLakh === 'number' ? data.currentBidLakh : null,
              biddingTeamId: data.currentBiddingTeamId || null,
            })
          );
        }

        // Check AR1 completion status on initial load and auto-transition to AR2 if complete
        if (data.currentRound === 'accelerated_1' && !data.currentPlayer && isAdmin) {
          console.log('🔍 Initial AR1 completion check on page load');
          try {
            const ar1Data = await auctionApi.getAvailableAR1Players(auctionId);
            const hasPlayersLeft = ar1Data.players && ar1Data.players.length > 0;

            if (!hasPlayersLeft) {
              // AR1 is complete - automatically transition to AR2
              console.log('🚀 AR1 complete, auto-transitioning to AR2...');
              await auctionApi.transitionToAR2(auctionId, adminToken!);
              console.log('✅ Auto-transitioned to AR2');
            } else {
              console.log(`🔍 AR1 has ${ar1Data.players.length} players remaining`);
            }

            setIsAR1Complete(!hasPlayersLeft);
          } catch (err: any) {
            console.error('❌ Failed initial AR1 check or auto-transition:', err);
          }
        }
      } catch (err: any) {
        console.error('Failed to fetch auction:', err);
        setError('Failed to load auction');
      } finally {
        setLoading(false);
      }
    };

    fetchAuction();
  }, [auctionId, myTeamId, dispatch]);

  // Setup WebSocket connection
  useEffect(() => {
    if (!auctionId || !myTeamId) return;

    socketService.connect();

    // Join auction room
    socketService.joinAuction(auctionId, myTeamId, sessionId);

    // Listen for auction_joined (initial state sync on join/refresh)
    socketService.on('auction_joined', (data: any) => {
      console.log('🎯 Auction joined - received full state:', data);

      // Update all teams
      if (data.allTeams) {
        dispatch(setTeams(data.allTeams));
      }

      // Update current player and bid
      if (data.currentPlayer) {
        dispatch(setCurrentPlayer(data.currentPlayer));
        dispatch(
          setCurrentBid({
            playerId: data.currentPlayer.id,
            currentBidLakh: data.currentPlayer.currentBidLakh,
            biddingTeamId: data.currentPlayer.biddingTeamId,
          })
        );

        // Dispatch custom event for agents
        const event = new CustomEvent('auction-player-update', { detail: data.currentPlayer });
        window.dispatchEvent(event);
      } else {
        dispatch(setCurrentPlayer(null));
        dispatch(setCurrentBid(null));
      }

      // Clear bid history (will be rebuilt as bids come in)
      dispatch(clearBidHistory());

      // Update RTM state
      if (data.rtmState) {
        dispatch(setRTMState(data.rtmState));
      } else {
        dispatch(clearRTMState());
      }

      // Update round and set
      if (data.auction.currentRound) {
        dispatch(setCurrentRound(data.auction.currentRound));
      }
      if (data.auction.currentSet) {
        dispatch(setCurrentSet(data.auction.currentSet));
      }
    });

    // Listen for auction started (includes first player)
    socketService.on('auction_started', (data: any) => {
      console.log('🎬 Auction started:', data);

      // Update auction status to in_progress
      if (data.status) {
        dispatch(setAuction({
          ...auctionState,
          status: data.status,
        }));
      }

      // Update current round if provided
      if (data.currentRound) {
        dispatch(setCurrentRound(data.currentRound));
      }

      // If first player is included, process it
      if (data.firstPlayer) {
        dispatch(setCurrentPlayer(data.firstPlayer));
        dispatch(
          setCurrentBid({
            playerId: data.firstPlayer.id,
            currentBidLakh: null,
            biddingTeamId: null,
          })
        );
        dispatch(clearBidHistory());
        dispatch(clearRTMState());

        // Dispatch custom event for agents
        const event = new CustomEvent('auction-player-update', { detail: data.firstPlayer });
        window.dispatchEvent(event);
      }
    });

    // Listen for bid updates
    socketService.on('bid_placed', (data: any) => {
      console.log('✅ Bid placed event received:', data);
      setBidding(false); // Reset bidding state on successful bid

      // Update Redux: current bid
      dispatch(
        setCurrentBid({
          playerId: data.playerId,
          currentBidLakh: data.bidAmountLakh,
          biddingTeamId: data.teamId,
        })
      );

      // Update Redux: bid history
      dispatch(
        addBidToHistory({
          id: Date.now().toString(),
          timestamp: data.timestamp,
          teamName: data.teamName,
          bidAmountLakh: data.bidAmountLakh,
          playerName: data.playerName,
        })
      );

      // Update team purse if provided
      if (data.teamPurseRemainingCr !== undefined) {
        dispatch(
          updateTeamPurse({
            teamId: data.teamId,
            purseRemainingCr: data.teamPurseRemainingCr,
          })
        );
      }

      // Dispatch custom event for agents
      const event = new CustomEvent('auction-bid-update', { detail: data });
      window.dispatchEvent(event);
    });

    // Listen for new player
    socketService.on('new_player', (data: any) => {
      console.log('New player:', data);

      // Update Redux: current player
      dispatch(setCurrentPlayer(data.player));
      dispatch(
        setCurrentBid({
          playerId: data.player.id,
          currentBidLakh: null, // No bids yet when player first appears
          biddingTeamId: null,
        })
      );

      // Clear bid history and RTM state
      dispatch(clearBidHistory());
      dispatch(clearRTMState());

      // Update round/set if provided
      if (data.currentRound) dispatch(setCurrentRound(data.currentRound));
      if (data.currentSet) dispatch(setCurrentSet(data.currentSet));

      // Dispatch custom event for agents
      const event = new CustomEvent('auction-player-update', { detail: data.player });
      window.dispatchEvent(event);
    });

    // Listen for player sold
    socketService.on('player_sold', (data: any) => {
      console.log('Player sold:', data);

      // Clear RTM state (player sold without RTM)
      dispatch(clearRTMState());

      // Update winning team stats
      if (data.winningTeam) {
        dispatch(
          updateTeamPurse({
            teamId: data.winningTeam.id,
            purseRemainingCr: data.winningTeam.purseRemainingCr,
          })
        );
        dispatch(
          updateTeamCounts({
            teamId: data.winningTeam.id,
            playerCount: data.winningTeam.playerCount,
            overseasCount: data.winningTeam.overseasCount,
          })
        );
        if (data.winningTeam.rtmCardsUsed !== undefined) {
          dispatch(
            updateTeamRTM({
              teamId: data.winningTeam.id,
              rtmCardsUsed: data.winningTeam.rtmCardsUsed,
              rtmCappedUsed: data.winningTeam.rtmCappedUsed,
              rtmUncappedUsed: data.winningTeam.rtmUncappedUsed,
            })
          );
        }
      }

      // Update RTM team stats (if different from winning team)
      if (data.rtmTeam && (!data.winningTeam || data.rtmTeam.id !== data.winningTeam.id)) {
        dispatch(
          updateTeamPurse({
            teamId: data.rtmTeam.id,
            purseRemainingCr: data.rtmTeam.purseRemainingCr,
          })
        );
        dispatch(
          updateTeamCounts({
            teamId: data.rtmTeam.id,
            playerCount: data.rtmTeam.playerCount,
            overseasCount: data.rtmTeam.overseasCount,
          })
        );
        dispatch(
          updateTeamRTM({
            teamId: data.rtmTeam.id,
            rtmCardsUsed: data.rtmTeam.rtmCardsUsed,
            rtmCappedUsed: data.rtmTeam.rtmCappedUsed,
            rtmUncappedUsed: data.rtmTeam.rtmUncappedUsed,
          })
        );
      }

      // Current player will be cleared when next player loads

      // Dispatch custom event for agents
      const event = new CustomEvent('auction-player-sold', { detail: data });
      window.dispatchEvent(event);
    });

    // Listen for player unsold
    socketService.on('player_unsold', (data: any) => {
      console.log('Player unsold:', data);

      // Clear RTM state
      dispatch(clearRTMState());

      // Current player will be cleared when next player loads

      // Dispatch custom event for agents
      const event = new CustomEvent('auction-player-unsold', { detail: data });
      window.dispatchEvent(event);
    });

    // Listen for RTM triggered
    socketService.on('rtm_triggered', (data: any) => {
      console.log('RTM triggered:', data);
      dispatch(setRTMState(data));

      // Dispatch custom event for agents
      const event = new CustomEvent('auction-rtm-triggered', { detail: data });
      window.dispatchEvent(event);
    });

    // Listen for RTM used
    socketService.on('rtm_used', (data: any) => {
      console.log('🎯 RTM used:', data);
      dispatch(setRTMState(data));

      // Dispatch custom event for agents
      const event = new CustomEvent('auction-rtm-used', { detail: data });
      window.dispatchEvent(event);
    });

    // Listen for counter-bid placed
    socketService.on('rtm_counter_bid_placed', (data: any) => {
      console.log('💰 Counter-bid placed:', data);
      // Backend sends full RTM state with counterBidMade: true
      dispatch(setRTMState(data));

      // Dispatch custom event for agents
      const event = new CustomEvent('auction-rtm-counter-bid', { detail: data });
      window.dispatchEvent(event);
    });

    // Listen for round completed
    socketService.on('round_completed', (data: any) => {
      console.log('🎊 Round completed:', data);
      setRoundCompleteMessage(data.message);
      // Clear current player since round is done
      dispatch(setCurrentPlayer(null));
      dispatch(setCurrentBid(null));

      // For AR2, auto-clear the message after 2 seconds to show player selection UI
      if (auctionState.currentRound === 'accelerated_2') {
        setTimeout(() => {
          setRoundCompleteMessage(null);
          console.log('✅ Auto-cleared AR2 round complete message');
        }, 2000);
      }
    });

    // Listen for round transition (when admin transitions to AR1/AR2)
    socketService.on('round_transition', (data: any) => {
      console.log('🚀 Round transition:', data);
      dispatch(setCurrentRound(data.round));
      setRoundCompleteMessage(null); // Clear the complete message
    });

    // Listen for errors
    socketService.on('auction_ended', (data: any) => {
      console.log('🏁 Auction ended:', data);
      setIsAuctionEnded(true);
      setActiveTab('squads');
      // Update auction status in Redux
      dispatch(
        setAuction({
          ...auctionState,
          status: 'completed',
        })
      );
    });

    socketService.on('error', (data: any) => {
      console.error('❌ Socket error:', data);
      setError(data.message);
      setBidding(false); // Reset bidding state on error
    });

    return () => {
      socketService.off('auction_joined');
      socketService.off('auction_started');
      socketService.off('bid_placed');
      socketService.off('new_player');
      socketService.off('player_sold');
      socketService.off('round_completed');
      socketService.off('round_transition');
      socketService.off('rtm_triggered');
      socketService.off('rtm_used');
      socketService.off('rtm_counter_bid_placed');
      socketService.off('auction_ended');
      socketService.off('error');
    };
  }, [auctionId, myTeamId, sessionId, dispatch, auctionState]);

  // Auto-scroll bid history
  useEffect(() => {
    if (bidHistoryRef.current) {
      bidHistoryRef.current.scrollTop = 0;
    }
  }, [bidHistory]);

  // Fetch pool data when Pool tab is activated
  useEffect(() => {
    if (activeTab === 'pool' && auctionId) {
      const fetchPoolData = async () => {
        try {
          const data = await auctionApi.getPoolData(auctionId);
          setPoolData(data);
        } catch (err: any) {
          console.error('Failed to fetch pool data:', err);
        }
      };
      fetchPoolData();
    }
  }, [activeTab, auctionId]);

  // Fetch squads data when Squads tab is activated
  useEffect(() => {
    if (activeTab === 'squads' && auctionId) {
      const fetchSquadsData = async () => {
        try {
          const data = await auctionApi.getSquadsData(auctionId);
          setSquadsData(data.teams);
        } catch (err: any) {
          console.error('Failed to fetch squads data:', err);
        }
      };
      fetchSquadsData();
    }
  }, [activeTab, auctionId]);

  // Check if AR1 is complete (no more players available) and auto-transition to AR2
  useEffect(() => {
    if (!auctionId || auctionState.currentRound !== 'accelerated_1' || !isAdmin) {
      return;
    }

    const checkAR1CompleteAndTransition = async () => {
      try {
        const data = await auctionApi.getAvailableAR1Players(auctionId);
        const hasPlayersLeft = data.players && data.players.length > 0;

        if (!hasPlayersLeft && adminToken) {
          // AR1 is complete - automatically transition to AR2
          console.log('🚀 AR1 complete (via useEffect), auto-transitioning to AR2...');
          await auctionApi.transitionToAR2(auctionId, adminToken);
          console.log('✅ Auto-transitioned to AR2');
        }

        setIsAR1Complete(!hasPlayersLeft);
      } catch (err: any) {
        console.error('❌ Failed to check AR1 completion or auto-transition:', err);
      }
    };

    checkAR1CompleteAndTransition();
  }, [auctionId, auctionState.currentRound, isAdmin, adminToken]);

  const handlePlaceBid = async () => {
    if (!currentPlayer || !myTeamId || !auctionId || bidding) return;

    // Use the same logic as display for consistency
    const currentBidValue = currentBidState?.currentBidLakh ?? null;
    let newBid: number;
    let increment: number;

    if (currentBidValue === null) {
      // No bids yet - first bid is base price (no increment)
      newBid = currentPlayer.basePriceLakh;
      increment = 0;
    } else {
      // Bids exist - add increment to current bid
      increment = getNextBidIncrement(currentBidValue);
      newBid = currentBidValue + increment;
    }

    console.log(`📝 Placing bid: Current=${currentBidValue}L, Increment=${increment}L, NewBid=${newBid}L`);

    setBidding(true);
    setError(null);

    try {
      socketService.placeBid(auctionId, currentPlayer.id, myTeamId, newBid);
    } catch (err: any) {
      console.error('Failed to place bid:', err);
      setError('Failed to place bid');
    } finally {
      setBidding(false);
    }
  };

  const handleSellPlayer = async () => {
    if (!currentPlayer || !auctionId || !adminToken) return;

    try {
      socketService.sellPlayer(auctionId, adminToken, currentPlayer.id);
    } catch (err: any) {
      console.error('Failed to sell player:', err);
      setError('Failed to sell player');
    }
  };

  const handleSkipPlayer = async () => {
    if (!currentPlayer || !auctionId || !adminToken) return;

    try {
      socketService.markUnsold(auctionId, adminToken, currentPlayer.id);
    } catch (err: any) {
      console.error('Failed to skip player:', err);
      setError('Failed to skip player');
    }
  };

  const handleTransitionToAR1 = async () => {
    if (!auctionId || !adminToken) return;

    try {
      console.log('🚀 Transitioning to Accelerated Round 1');
      await auctionApi.transitionToAR1(auctionId, adminToken);
      setRoundCompleteMessage(null); // Clear the message
      // Update round in Redux
      dispatch(setCurrentRound('accelerated_1'));
      console.log('✅ Transitioned to AR1');
    } catch (err: any) {
      console.error('Failed to transition to AR1:', err);
      setError('Failed to transition to Accelerated Round 1');
    }
  };

  const handleTransitionToAR2 = async () => {
    if (!auctionId || !adminToken) return;

    try {
      await auctionApi.transitionToAR2(auctionId, adminToken);
      console.log('✅ Transitioned to AR2');

      // Reset AR1 complete flag
      setIsAR1Complete(false);

      // Automatically load AR2 players after transition
      setTimeout(async () => {
        try {
          const data = await auctionApi.getAvailableAR2Players(auctionId);
          setAr1Players(data.players); // Reuse the same state
          setSelectedPlayerIds([]);
          setShowPlayerModal(true);
          console.log(`📋 Auto-loaded ${data.players.length} AR2 players`);
        } catch (err: any) {
          console.error('Failed to auto-load AR2 players:', err);
        }
      }, 500); // Small delay to let the round transition complete
    } catch (err: any) {
      console.error('Failed to transition to AR2:', err);
      setError('Failed to transition to Accelerated Round 2');
    }
  };

  const handleLoadAR1Players = async () => {
    if (!auctionId) return;

    try {
      const data = await auctionApi.getAvailableAR1Players(auctionId);
      setAr1Players(data.players);
      setSelectedPlayerIds([]);
      setShowPlayerModal(true);
      console.log(`📋 Loaded ${data.players.length} AR1 players`);
    } catch (err: any) {
      console.error('Failed to fetch AR1 players:', err);
      setError('Failed to load available players');
    }
  };

  const handleLoadAR2Players = async () => {
    if (!auctionId) return;

    try {
      const data = await auctionApi.getAvailableAR2Players(auctionId);
      setAr1Players(data.players); // Reuse the same state for simplicity
      setSelectedPlayerIds([]);
      setShowPlayerModal(true);
      console.log(`📋 Loaded ${data.players.length} AR2 players`);
    } catch (err: any) {
      console.error('Failed to fetch AR2 players:', err);
      setError('Failed to load available players');
    }
  };

  const handleTogglePlayerSelection = (playerId: string) => {
    setSelectedPlayerIds(prev =>
      prev.includes(playerId)
        ? prev.filter(id => id !== playerId)
        : [...prev, playerId]
    );
  };

  const handleLoadSelectedPlayers = async () => {
    if (!auctionId || !adminToken || selectedPlayerIds.length === 0) return;

    try {
      console.log(`🎯 Queueing ${selectedPlayerIds.length} selected players`);

      // Send all selected player IDs to backend - it will queue them and load the first one
      await auctionApi.queueAR1Players(auctionId, adminToken, selectedPlayerIds);

      // Clear selection and close modal
      setSelectedPlayerIds([]);
      setShowPlayerModal(false);

      console.log(`✅ Queued ${selectedPlayerIds.length} players. First player loaded, others will auto-advance.`);
    } catch (err: any) {
      console.error('Failed to queue players:', err);
      setError('Failed to queue players');
    }
  };

  const handleEndAuction = async () => {
    if (!auctionId || !adminToken) return;

    const confirmed = window.confirm('Are you sure you want to end this auction? This action cannot be undone.');
    if (!confirmed) return;

    try {
      console.log('🏁 Ending auction');
      socketService.endAuction(auctionId, adminToken);
    } catch (err: any) {
      console.error('Failed to end auction:', err);
      setError('Failed to end auction');
    }
  };

  const handleUseRTM = async () => {
    if (!auctionId || !myTeamId) return;

    try {
      console.log('🎯 Using RTM card');
      socketService.useRTM(auctionId, myTeamId);
    } catch (err: any) {
      console.error('Failed to use RTM:', err);
      setError('Failed to use RTM');
    }
  };

  const handleFinalizeRTM = async (rtmAccepts: boolean) => {
    if (!auctionId || !myTeamId) return;

    try {
      console.log(`🎯 Finalizing RTM: ${rtmAccepts ? 'RTM Team Accepts' : 'Pass to Original Winner'}`);
      socketService.finalizeRTM(auctionId, myTeamId, rtmAccepts);
    } catch (err: any) {
      console.error('Failed to finalize RTM:', err);
      setError('Failed to finalize RTM');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-blue-800 flex items-center justify-center">
        <div className="text-white text-2xl">Loading auction...</div>
      </div>
    );
  }

  if (error && !auctionState.id) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-blue-800 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-2xl max-w-md">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-700">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="mt-6 w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Get current bid from Redux state ONLY (don't fallback to base price)
  const currentBid = currentBidState?.currentBidLakh ?? null;
  const currentBiddingTeam = currentBidState?.biddingTeamId
    ? teams.find(t => t.id === currentBidState.biddingTeamId)
    : null;

  // For bidding logic, calculate next bid
  let nextBid: number;
  let increment: number;

  if (currentBid === null) {
    // No bids yet - first bid is base price (no increment)
    nextBid = currentPlayer?.basePriceLakh || 0;
    increment = 0;
  } else {
    // Bids exist - add increment to current bid
    increment = getNextBidIncrement(currentBid);
    nextBid = currentBid + increment;
  }

  const canBid = myTeam && myTeam.purseRemainingCr * 100 >= nextBid;

  // Check if my team is the current highest bidder (disable bid button until another team bids)
  const isMyTeamCurrentBidder = currentBidState?.biddingTeamId === myTeamId;

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-blue-800"
      data-auction-started={auctionState.status === 'in_progress' ? 'true' : undefined}
    >
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-2xl p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">{auctionState.name}</h1>
              <div className="flex items-center gap-4 text-gray-600 mt-1">
                <span className="font-semibold">{auctionState.currentRound?.toUpperCase()}</span>
                {auctionState.currentSet && <span>Set: {auctionState.currentSet}</span>}
              </div>
            </div>
            {myTeam && (
              <div className="bg-purple-100 px-6 py-3 rounded-lg">
                <div className="text-sm text-purple-600 font-semibold">Your Team: {myTeam.teamName}</div>
                <div className="text-2xl font-bold text-purple-900">
                  ₹{Number(myTeam.purseRemainingCr).toFixed(2)} cr
                </div>
                <div className="text-xs text-purple-600 mt-1">
                  {myTeam.playerCount} players • {myTeam.overseasCount} overseas
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-500 text-white px-6 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="bg-white rounded-xl shadow-2xl mb-6 overflow-hidden">
          <div className="flex">
            <button
              onClick={() => !isAuctionEnded && setActiveTab('auction')}
              disabled={isAuctionEnded}
              className={`flex-1 py-4 px-6 text-center font-semibold transition-all duration-200 relative ${
                isAuctionEnded
                  ? 'text-gray-400 bg-gray-100 cursor-not-allowed opacity-60'
                  : activeTab === 'auction'
                  ? 'text-white bg-gradient-to-r from-purple-600 to-purple-700 shadow-lg'
                  : 'text-gray-600 hover:text-purple-600 hover:bg-purple-50'
              }`}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span className="text-xl">🎯</span>
                <span>Auction</span>
              </span>
              {activeTab === 'auction' && !isAuctionEnded && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-800"></div>
              )}
            </button>
            <button
              onClick={() => !isAuctionEnded && setActiveTab('pool')}
              disabled={isAuctionEnded}
              className={`flex-1 py-4 px-6 text-center font-semibold transition-all duration-200 relative ${
                isAuctionEnded
                  ? 'text-gray-400 bg-gray-100 cursor-not-allowed opacity-60'
                  : activeTab === 'pool'
                  ? 'text-white bg-gradient-to-r from-purple-600 to-purple-700 shadow-lg'
                  : 'text-gray-600 hover:text-purple-600 hover:bg-purple-50'
              }`}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span className="text-xl">🏊</span>
                <span>Pool</span>
              </span>
              {activeTab === 'pool' && !isAuctionEnded && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-800"></div>
              )}
            </button>
            <button
              onClick={() => setActiveTab('squads')}
              className={`flex-1 py-4 px-6 text-center font-semibold transition-all duration-200 relative ${
                activeTab === 'squads'
                  ? 'text-white bg-gradient-to-r from-purple-600 to-purple-700 shadow-lg'
                  : 'text-gray-600 hover:text-purple-600 hover:bg-purple-50'
              }`}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span className="text-xl">👥</span>
                <span>Squads</span>
              </span>
              {activeTab === 'squads' && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-800"></div>
              )}
            </button>
          </div>
        </div>

        {activeTab === 'auction' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Auction Area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Current Player */}
            {roundCompleteMessage ? (
              <div className="bg-white rounded-xl shadow-2xl p-16 text-center">
                <div className="text-green-500 text-6xl mb-4">🎊</div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">
                  Round Complete!
                </h2>
                <p className="text-gray-600 mb-6">
                  {roundCompleteMessage}
                </p>
                {isAdmin && (
                  <>
                    {auctionState.currentRound === 'normal' && (
                      <button
                        onClick={handleTransitionToAR1}
                        className="bg-purple-600 text-white px-8 py-4 rounded-lg hover:bg-purple-700 font-bold text-lg transition-colors"
                      >
                        🚀 Start Accelerated Round 1
                      </button>
                    )}
                    {auctionState.currentRound === 'accelerated_1' && (
                      <button
                        onClick={handleTransitionToAR2}
                        className="bg-orange-600 text-white px-8 py-4 rounded-lg hover:bg-orange-700 font-bold text-lg transition-colors"
                      >
                        🏁 Start Accelerated Round 2
                      </button>
                    )}
                  </>
                )}
                {!isAdmin && (
                  <p className="text-gray-500 italic">
                    Waiting for admin to start {auctionState.currentRound === 'normal' ? 'Accelerated Round 1' : 'Accelerated Round 2'}...
                  </p>
                )}
              </div>
            ) : currentPlayer ? (
              <div className="bg-white rounded-xl shadow-2xl p-8">
                <div className="text-center mb-6">
                  <h2 className="text-4xl font-bold text-gray-800 mb-2">
                    {currentPlayer.name}
                  </h2>
                  <div className="flex items-center justify-center gap-4 text-gray-600">
                    <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-semibold">
                      {currentPlayer.role}
                    </span>
                    <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full">
                      {currentPlayer.country}
                    </span>
                    {currentPlayer.isOverseas && (
                      <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full">
                        Overseas
                      </span>
                    )}
                    <span className={`${currentPlayer.isCapped ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'} px-3 py-1 rounded-full`}>
                      {currentPlayer.isCapped ? 'Capped' : 'Uncapped'}
                    </span>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl p-8 text-center mb-6">
                  <div className="text-white text-sm mb-2">CURRENT BID</div>
                  {currentBid ? (
                    <>
                      <div className="text-white text-6xl font-bold">
                        ₹{currentBid / 100} cr
                      </div>
                      {currentBiddingTeam && (
                        <div className="text-white text-xl font-semibold mt-3">
                          {currentBiddingTeam.teamName}
                        </div>
                      )}
                      {currentBid > currentPlayer.basePriceLakh && (
                        <div className="text-white text-sm mt-2">
                          Base: ₹{currentPlayer.basePriceLakh / 100} cr
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-white text-4xl font-bold">
                        No bids yet
                      </div>
                      <div className="text-white text-sm mt-2">
                        Base Price: ₹{currentPlayer.basePriceLakh / 100} cr
                      </div>
                    </>
                  )}
                </div>

                {/* Player Sold Banner - Shows before RTM */}
                {rtmState && (
                  <div className="bg-green-100 border-2 border-green-500 rounded-xl p-4 mb-4 text-center">
                    <p className="text-green-800 font-bold text-lg">
                      ✅ SOLD to {rtmState.originalWinnerTeamName} for ₹{rtmState.matchedBidLakh / 100} cr
                    </p>
                  </div>
                )}

                {/* RTM State */}
                {rtmState && (
                  <div className="bg-yellow-100 border-2 border-yellow-500 rounded-xl p-6 mb-6">
                    <h3 className="text-xl font-bold text-yellow-900 mb-2">
                      🎯 RTM {rtmState.counterBidAllowed ? 'IN PROGRESS' : 'TRIGGERED'}
                    </h3>

                    {/* Stage 1: RTM team hasn't used RTM card yet */}
                    {!rtmState.counterBidAllowed && !(rtmState as any).counterBidMade && (
                      <>
                        <p className="text-yellow-800 mb-4">
                          {rtmState.rtmTeamName} can match the bid of ₹{rtmState.matchedBidLakh / 100} cr or pass
                        </p>
                        {myTeam && rtmState.rtmTeamId === myTeamId && (
                          <div className="flex gap-3">
                            <button
                              onClick={handleUseRTM}
                              className="flex-1 bg-yellow-600 text-white px-6 py-3 rounded-lg hover:bg-yellow-700 transition-colors font-bold"
                            >
                              ✅ Use RTM - Match ₹{rtmState.matchedBidLakh / 100} cr
                            </button>
                            <button
                              onClick={() => handleFinalizeRTM(false)}
                              className="flex-1 bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors font-bold"
                            >
                              ❌ Pass
                            </button>
                          </div>
                        )}
                        {myTeam && rtmState.rtmTeamId !== myTeamId && (
                          <p className="text-gray-600 text-center text-sm">
                            Waiting for {rtmState.rtmTeamName} to decide...
                          </p>
                        )}
                      </>
                    )}

                    {/* Stage 2: RTM used, original winner decides counter-bid or pass */}
                    {rtmState.counterBidAllowed && (
                      <>
                        <p className="text-green-800 font-semibold mb-2">
                          ✅ {rtmState.rtmTeamName} matched at ₹{rtmState.matchedBidLakh / 100} cr!
                        </p>
                        <p className="text-yellow-700 text-sm mb-4">
                          {rtmState.originalWinnerTeamName} can make ONE final counter-bid or pass
                        </p>

                        {/* Original winner's controls */}
                        {myTeam && rtmState.originalWinnerTeamId === myTeamId && (
                          <div className="space-y-2">
                            <input
                              type="number"
                              step="0.05"
                              min={(rtmState.matchedBidLakh / 100) + 0.05}
                              placeholder={`Bid > ₹${rtmState.matchedBidLakh / 100} cr`}
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                              id="counterBidInput"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={() => {
                                  const input = document.getElementById('counterBidInput') as HTMLInputElement;
                                  const newBidCr = parseFloat(input.value);
                                  if (newBidCr && newBidCr > rtmState.matchedBidLakh / 100) {
                                    socketService.rtmCounterBid(auctionId!, myTeamId!, newBidCr * 100);
                                  } else {
                                    setError('Counter-bid must be higher');
                                  }
                                }}
                                className="bg-orange-600 text-white px-4 py-3 rounded-lg hover:bg-orange-700 font-bold"
                              >
                                Counter-Bid
                              </button>
                              <button
                                onClick={() => handleFinalizeRTM(true)}
                                className="bg-gray-500 text-white px-4 py-3 rounded-lg hover:bg-gray-600 font-bold"
                              >
                                Pass
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Other teams see waiting message */}
                        {myTeam && rtmState.originalWinnerTeamId !== myTeamId && rtmState.rtmTeamId !== myTeamId && (
                          <p className="text-gray-600 text-center text-sm">
                            Waiting for {rtmState.originalWinnerTeamName}'s decision...
                          </p>
                        )}
                      </>
                    )}

                    {/* Stage 3: After counter-bid, RTM team decides to match or pass */}
                    {(rtmState as any).counterBidMade && myTeam && rtmState.rtmTeamId === myTeamId && (
                      <>
                        <p className="text-orange-800 font-semibold mb-2">
                          💰 Counter-bid placed: ₹{rtmState.matchedBidLakh / 100} cr
                        </p>
                        <p className="text-yellow-700 text-sm mb-4">
                          Do you want to match this final bid?
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          <button
                            onClick={() => handleFinalizeRTM(true)}
                            className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-bold"
                          >
                            Match ₹{rtmState.matchedBidLakh / 100} cr
                          </button>
                          <button
                            onClick={() => handleFinalizeRTM(false)}
                            className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 font-bold"
                          >
                            Pass
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Debug Info - Remove after testing */}
                <div className="bg-gray-100 p-2 text-xs mb-4 rounded">
                  <strong>Debug:</strong> isAdmin={String(isAdmin)} | myTeamId={myTeamId || 'null'} |
                  purse={myTeam ? `₹${myTeam.purseRemainingCr}cr` : 'null'} |
                  nextBid={nextBid}L (₹{nextBid/100}cr) |
                  canBid={String(canBid)} |
                  isMyTeamCurrentBidder={String(isMyTeamCurrentBidder)} |
                  currentBiddingTeamId={currentBidState?.biddingTeamId || 'null'}
                </div>

                {/* Combined Controls Section - Bidding + Admin */}
                <div className="space-y-4">
                  {/* Bidding Controls - Show if user has a team */}
                  {myTeamId && (
                    <>
                      <button
                        onClick={handlePlaceBid}
                        disabled={bidding || !canBid || !!rtmState || isMyTeamCurrentBidder}
                        className="w-full bg-green-600 text-white px-8 py-4 rounded-xl hover:bg-green-700 transition-colors font-bold text-xl disabled:bg-gray-400 disabled:cursor-not-allowed"
                        data-bid-button
                      >
                        {bidding ? 'Placing Bid...' : rtmState ? 'RTM in Progress...' : isMyTeamCurrentBidder ? 'Waiting for Other Teams...' : increment > 0 ? `Bid ₹${nextBid / 100} cr (+₹${increment}L)` : `Bid ₹${nextBid / 100} cr`}
                      </button>
                      {!canBid && !rtmState && !isMyTeamCurrentBidder && (
                        <p className="text-red-600 text-center text-sm">
                          Insufficient purse to bid
                        </p>
                      )}
                      {rtmState && (
                        <p className="text-yellow-600 text-center text-sm">
                          RTM in progress - Bidding disabled
                        </p>
                      )}
                      {isMyTeamCurrentBidder && !rtmState && (
                        <p className="text-blue-600 text-center text-sm">
                          You're the highest bidder - Wait for another team to bid
                        </p>
                      )}
                    </>
                  )}

                  {/* Admin Controls - Show below bidding controls if admin */}
                  {isAdmin && (
                    <>
                      {/* During RTM: Show status message */}
                      {rtmState && (
                        <div className="bg-blue-100 border border-blue-400 rounded-lg p-3 text-center">
                          <p className="text-blue-800 text-sm font-semibold">
                            ⏳ RTM in progress - Will auto-advance when resolved
                          </p>
                        </div>
                      )}

                      {/* Smart admin action buttons - context-aware */}
                      {!rtmState && (
                        <>
                          {/* Separator if both sections visible */}
                          {myTeamId && (
                            <div className="border-t border-gray-300 pt-4">
                              <p className="text-gray-600 text-xs text-center mb-3 font-semibold">
                                ADMIN CONTROLS
                              </p>
                            </div>
                          )}
                          <div className="flex gap-4">
                            {currentBiddingTeam ? (
                              // If bids placed, show Sell button
                              <button
                                onClick={handleSellPlayer}
                                className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-bold transition-colors"
                              >
                                Sell to {currentBiddingTeam.teamName} (₹{currentBid! / 100} cr)
                              </button>
                            ) : (
                              // If no bids, show Mark Unsold button (auto-advances)
                              <button
                                onClick={handleSkipPlayer}
                                className="flex-1 bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-700 font-bold transition-colors"
                              >
                                Mark Unsold & Next Player
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : auctionState.currentRound === 'accelerated_1' && isAdmin ? (
              isAR1Complete ? (
                <div className="bg-white rounded-xl shadow-2xl p-16 text-center">
                  <div className="text-green-500 text-6xl mb-4">🎊</div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-2">
                    Accelerated Round 1 Complete!
                  </h2>
                  <p className="text-gray-600 mb-6">
                    All AR1 players have been processed. Ready for Accelerated Round 2.
                  </p>
                  <button
                    onClick={handleTransitionToAR2}
                    className="bg-orange-600 text-white px-8 py-4 rounded-lg hover:bg-orange-700 font-bold text-lg transition-colors"
                  >
                    🏁 Start Accelerated Round 2
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-2xl p-8">
                  <div className="text-center mb-6">
                    <div className="text-purple-500 text-5xl mb-3">🚀</div>
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">
                      Accelerated Round 1
                    </h2>
                    <p className="text-gray-600">
                      Select a player from UBA2 onwards to auction
                    </p>
                  </div>

                  <button
                    onClick={handleLoadAR1Players}
                    className="w-full bg-purple-600 text-white px-6 py-4 rounded-lg hover:bg-purple-700 font-bold text-lg transition-colors"
                  >
                    📋 View & Select Players
                  </button>
                </div>
              )
            ) : auctionState.currentRound === 'accelerated_2' && isAdmin ? (
              <div className="bg-white rounded-xl shadow-2xl p-8">
                <div className="text-center mb-6">
                  <div className="text-orange-500 text-5xl mb-3">🏁</div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-2">
                    Accelerated Round 2
                  </h2>
                  <p className="text-gray-600">
                    Select from all unsold & remaining players
                  </p>
                </div>

                <div className="space-y-4">
                  <button
                    onClick={handleLoadAR2Players}
                    className="w-full bg-orange-600 text-white px-6 py-4 rounded-lg hover:bg-orange-700 font-bold text-lg transition-colors"
                  >
                    📋 View & Select Players
                  </button>

                  <button
                    onClick={handleEndAuction}
                    className="w-full bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 font-bold text-lg transition-colors border-2 border-red-700"
                  >
                    🏁 End Auction
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-2xl p-16 text-center">
                <div className="text-gray-400 text-6xl mb-4">🏏</div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">
                  Waiting for Player
                </h2>
                <p className="text-gray-600">
                  {auctionState.currentRound === 'accelerated_1'
                    ? 'Admin will select the next player'
                    : isAdmin
                      ? 'Click "Next" to load the first player'
                      : 'Admin will load the next player shortly'}
                </p>
              </div>
            )}

            {/* Bid History */}
            <div className="bg-white rounded-xl shadow-2xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Bid History</h3>
              <div
                ref={bidHistoryRef}
                className="space-y-2 max-h-64 overflow-y-auto"
              >
                {bidHistory.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No bids yet</p>
                ) : (
                  bidHistory.map((bid) => (
                    <div
                      key={bid.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <span className="font-bold text-gray-800">{bid.teamName}</span>
                        <span className="text-gray-600 text-sm ml-2">
                          {new Date(bid.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-lg font-bold text-green-600">
                        ₹{bid.bidAmountLakh / 100} cr
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Sidebar - Teams */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-2xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">All Teams</h3>
              <div className="space-y-3">
                {teams.map((team) => (
                  <div
                    key={team.id}
                    className={`p-4 rounded-lg border-2 ${
                      team.id === myTeamId
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-gray-800">{team.teamName}</h4>
                      {team.id === myTeamId && (
                        <span className="bg-purple-500 text-white px-2 py-1 rounded text-xs font-bold">
                          YOU
                        </span>
                      )}
                    </div>
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between text-gray-600">
                        <span>Purse:</span>
                        <span className="font-bold text-green-600">
                          ₹{Number(team.purseRemainingCr).toFixed(2)} cr
                        </span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Players:</span>
                        <span className="font-bold">{team.playerCount}</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>RTM:</span>
                        <span className="font-bold">
                          {team.rtmCardsTotal - team.rtmCardsUsed} / {team.rtmCardsTotal}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Pool Tab */}
        {activeTab === 'pool' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Sold Players */}
            <div className="bg-white rounded-xl shadow-2xl p-6">
              <h2 className="text-2xl font-bold text-green-600 mb-4 flex items-center gap-2">
                <span>✅</span>
                <span>Sold Players ({poolData.sold.length})</span>
              </h2>
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {poolData.sold.map((player: any) => (
                  <div key={player.id} className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="font-semibold text-gray-800">{player.name}</div>
                    <div className="text-sm text-gray-600">{player.role} • {player.country}</div>
                    <div className="text-sm font-semibold text-green-600 mt-1">
                      {player.teamName} • ₹{player.soldPriceCr} cr
                    </div>
                  </div>
                ))}
                {poolData.sold.length === 0 && (
                  <div className="text-gray-400 text-center py-8">No players sold yet</div>
                )}
              </div>
            </div>

            {/* Pending Players */}
            <div className="bg-white rounded-xl shadow-2xl p-6">
              <h2 className="text-2xl font-bold text-blue-600 mb-4 flex items-center gap-2">
                <span>⏳</span>
                <span>Pending Players ({poolData.pending.length})</span>
              </h2>
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {poolData.pending.map((player: any) => (
                  <div key={player.id} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="font-semibold text-gray-800">{player.name}</div>
                    <div className="text-sm text-gray-600">{player.role} • {player.country}</div>
                    <div className="text-sm text-blue-600 mt-1">
                      Base: ₹{player.basePriceLakh / 100} cr • Set: {player.auctionSet}
                    </div>
                  </div>
                ))}
                {poolData.pending.length === 0 && (
                  <div className="text-gray-400 text-center py-8">No pending players</div>
                )}
              </div>
            </div>

            {/* Unsold Players */}
            <div className="bg-white rounded-xl shadow-2xl p-6">
              <h2 className="text-2xl font-bold text-red-600 mb-4 flex items-center gap-2">
                <span>❌</span>
                <span>Unsold Players ({poolData.unsold.length})</span>
              </h2>
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {poolData.unsold.map((player: any) => (
                  <div key={player.id} className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="font-semibold text-gray-800">{player.name}</div>
                    <div className="text-sm text-gray-600">{player.role} • {player.country}</div>
                    <div className="text-sm text-red-600 mt-1">
                      Base: ₹{player.basePriceLakh / 100} cr • Set: {player.auctionSet}
                    </div>
                  </div>
                ))}
                {poolData.unsold.length === 0 && (
                  <div className="text-gray-400 text-center py-8">No unsold players</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Squads Tab */}
        {activeTab === 'squads' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {squadsData.map((team: any) => (
              <div key={team.id} className="bg-white rounded-xl shadow-2xl p-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">{team.teamName}</h2>
                <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                  <span>₹{team.purseRemainingCr.toFixed(2)} cr</span>
                  <span>•</span>
                  <span>{team.playerCount} players</span>
                  <span>•</span>
                  <span>{team.overseasCount} overseas</span>
                </div>
                <div className="border-t pt-4 space-y-2 max-h-[500px] overflow-y-auto">
                  {team.players && team.players.length > 0 ? (
                    team.players.map((player: any) => (
                      <div key={player.id} className="bg-gray-50 rounded-lg p-3">
                        <div className="font-semibold text-gray-800">{player.name}</div>
                        <div className="text-sm text-gray-600">{player.role} • {player.country}</div>
                        <div className="text-sm font-semibold text-purple-600 mt-1">
                          ₹{player.soldPriceLakh / 100} cr
                          {player.isRetained && <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded">Retained</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-400 text-center py-4">No players yet</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Player Selection Modal for AR1 */}
      {showPlayerModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">
                    Select Players for {auctionState.currentRound === 'accelerated_1' ? 'AR1' : 'AR2'}
                  </h2>
                  <p className="text-gray-600 mt-1">
                    {ar1Players.length} players available • {selectedPlayerIds.length} selected
                  </p>
                </div>
                <button
                  onClick={() => setShowPlayerModal(false)}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                >
                  ×
                </button>
              </div>
              {selectedPlayerIds.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={handleLoadSelectedPlayers}
                    className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 font-bold transition-colors"
                  >
                    🎯 Queue {selectedPlayerIds.length} Player{selectedPlayerIds.length > 1 ? 's' : ''} & Start
                  </button>
                </div>
              )}
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ar1Players.map((player) => {
                  const isSelected = selectedPlayerIds.includes(player.id);
                  return (
                    <div
                      key={player.id}
                      className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-purple-600 bg-purple-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                      onClick={() => handleTogglePlayerSelection(player.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-lg text-gray-800">
                            {player.name}
                          </h3>
                          {isSelected && (
                            <span className="text-purple-600 text-xl">✓</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-sm">
                            {player.role}
                          </span>
                          <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-sm">
                            {player.country}
                          </span>
                          {player.isOverseas && (
                            <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded text-sm">
                              Overseas
                            </span>
                          )}
                        </div>
                        <div className="mt-2 text-sm text-gray-600">
                          <span className="font-semibold">Set:</span> {player.auctionSet}
                        </div>
                        <div className="mt-1 text-lg font-bold text-purple-600">
                          ₹{player.basePriceLakh / 100} cr
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
