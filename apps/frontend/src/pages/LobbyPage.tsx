import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { auctionApi, sessionApi } from '../services/api';
import socketService from '../services/socket';
import { setAuction, setStatus } from '../store/slices/auctionSlice';
import { setTeams, setMyTeamId, updateTeam } from '../store/slices/teamsSlice';
import { selectAllTeams } from '../store/selectors';

interface Team {
  id: string;
  teamName: string;
  purseRemainingCr: number;
  rtmCardsTotal: number;
  playerCount: number;
  overseasCount: number;
  ownerSessionId: string | null;
  retainedPlayers: {
    name: string;
    role: string;
    priceCr: number;
    isOverseas: boolean;
  }[];
}

interface Auction {
  id: string;
  name: string;
  type: 'public' | 'private';
  roomCode: string | null;
  status: string;
  teams: Team[];
}

const TEAM_COLORS: Record<string, { primary: string; secondary: string }> = {
  RCB: { primary: 'bg-red-600', secondary: 'border-red-600' },
  CSK: { primary: 'bg-yellow-500', secondary: 'border-yellow-500' },
  MI: { primary: 'bg-blue-600', secondary: 'border-blue-600' },
  KKR: { primary: 'bg-purple-700', secondary: 'border-purple-700' },
  DC: { primary: 'bg-blue-500', secondary: 'border-blue-500' },
  PBKS: { primary: 'bg-red-500', secondary: 'border-red-500' },
  RR: { primary: 'bg-pink-500', secondary: 'border-pink-500' },
  SRH: { primary: 'bg-orange-600', secondary: 'border-orange-600' },
  GT: { primary: 'bg-gray-800', secondary: 'border-gray-800' },
  LSG: { primary: 'bg-cyan-500', secondary: 'border-cyan-500' },
};

export default function LobbyPage() {
  const { auctionId } = useParams<{ auctionId: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Redux state
  const teams = useSelector(selectAllTeams);

  // Local state
  const [auction, setLocalAuction] = useState<Auction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [joiningTeam, setJoiningTeam] = useState(false);
  const [startingAuction, setStartingAuction] = useState(false);

  const sessionId = sessionApi.getSessionId();
  const isAdmin = auctionId ? sessionApi.isAdmin(auctionId) : false;

  useEffect(() => {
    if (!auctionId) return;

    const fetchAuction = async () => {
      try {
        const data = await auctionApi.getAuction(auctionId);
        setLocalAuction(data);

        // Update Redux store
        dispatch(
          setAuction({
            id: data.id,
            name: data.name,
            status: data.status,
            roomCode: data.roomCode,
          })
        );
        dispatch(setTeams(data.teams));

        // Find if user already has a team
        const myTeam = data.teams.find((t: Team) => t.ownerSessionId === sessionId);
        if (myTeam) {
          setSelectedTeam(myTeam);
          dispatch(setMyTeamId(myTeam.id));
          sessionApi.setTeamId(auctionId, myTeam.id);
        }
      } catch (err: any) {
        console.error('Failed to fetch auction:', err);
        setError(err.response?.data?.message || 'Failed to load auction');
      } finally {
        setLoading(false);
      }
    };

    fetchAuction();
  }, [auctionId, sessionId, dispatch]);

  // WebSocket: Connect, join lobby, and listen for team_joined events (for ALL users in lobby)
  useEffect(() => {
    if (!auctionId) return;

    console.log(`🔌 Connecting socket for auction: ${auctionId}`);
    const socket = socketService.connect();

    // Join the lobby room (no team required)
    socketService.joinLobby(auctionId);
    console.log(`🚪 Joining lobby for auction: ${auctionId}`);

    // Listen for team_joined events
    const handleTeamJoined = (data: { teamId: string; teamName: string; ownerSessionId: string }) => {
      console.log('✅ Team joined event received:', data);

      // Update local state
      setLocalAuction((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          teams: prev.teams.map((t) =>
            t.id === data.teamId ? { ...t, ownerSessionId: data.ownerSessionId } : t
          ),
        };
      });

      // Update Redux state - find existing team and update only ownerSessionId
      const existingTeam = teams.find((t: any) => t.id === data.teamId);
      if (existingTeam) {
        dispatch(
          updateTeam({
            ...existingTeam,
            ownerSessionId: data.ownerSessionId,
          })
        );
      }
    };

    const handleLobbyJoined = (data: { auctionId: string; roomName: string }) => {
      console.log('✅ Lobby joined successfully:', data);
    };

    const handleSocketError = (error: any) => {
      console.error('❌ Socket error:', error);
    };

    const handleAuctionStarted = (data: { auctionId: string; status: string }) => {
      console.log('🎬 Auction started event received:', data);
      // Redirect to auction page
      navigate(`/auction/${auctionId}`);
    };

    socket.on('team_joined', handleTeamJoined);
    socket.on('lobby_joined', handleLobbyJoined);
    socket.on('auction_started', handleAuctionStarted);
    socket.on('error', handleSocketError);
    console.log(`👂 Listening for team_joined and auction_started events in auction: ${auctionId}`);

    return () => {
      console.log(`🔇 Removing listeners for auction: ${auctionId}`);
      socketService.off('team_joined', handleTeamJoined);
      socketService.off('lobby_joined', handleLobbyJoined);
      socketService.off('auction_started', handleAuctionStarted);
      socketService.off('error', handleSocketError);
    };
  }, [auctionId, teams, dispatch, navigate]);

  // WebSocket: Join auction room (only when user selects a team)
  useEffect(() => {
    if (!auctionId || !selectedTeam) return;

    console.log(`🚪 Joining auction room: ${auctionId} as ${selectedTeam.teamName}`);
    socketService.joinAuction(auctionId, selectedTeam.id, sessionId);

    return () => {
      console.log(`🚪 Left auction room: ${auctionId}`);
    };
  }, [auctionId, selectedTeam, sessionId]);

  const handleSelectTeam = async (team: Team) => {
    if (!auctionId || team.ownerSessionId || joiningTeam) return;

    setJoiningTeam(true);
    setError(null);

    try {
      await auctionApi.joinAuction(auctionId, {
        teamId: team.id,
        sessionId,
      });

      // Store team ID in localStorage
      sessionApi.setTeamId(auctionId, team.id);

      // Update Redux state
      dispatch(setMyTeamId(team.id));
      dispatch(
        setTeams(
          teams.map((t: any) => (t.id === team.id ? { ...t, ownerSessionId: sessionId } : t))
        )
      );

      // Update local state
      setSelectedTeam(team);
      setLocalAuction((prev) =>
        prev
          ? {
              ...prev,
              teams: prev.teams.map((t) =>
                t.id === team.id ? { ...t, ownerSessionId: sessionId } : t
              ),
            }
          : null
      );
    } catch (err: any) {
      console.error('Failed to join team:', err);
      setError(err.response?.data?.message || 'Failed to select team');
    } finally {
      setJoiningTeam(false);
    }
  };

  const handleStartAuction = async () => {
    if (!auctionId || !isAdmin || startingAuction) return;

    setStartingAuction(true);
    setError(null);

    try {
      const adminToken = sessionApi.getAdminToken(auctionId);
      if (!adminToken) {
        throw new Error('Admin authorization required');
      }

      await auctionApi.startAuction(auctionId, adminToken);

      // Update Redux status
      dispatch(setStatus('in_progress'));

      // Navigate to auction page
      navigate(`/auction/${auctionId}`);
    } catch (err: any) {
      console.error('Failed to start auction:', err);
      setError(err.response?.data?.message || 'Failed to start auction');
    } finally {
      setStartingAuction(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-blue-800 flex items-center justify-center">
        <div className="text-white text-2xl">Loading auction...</div>
      </div>
    );
  }

  if (error && !auction) {
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

  if (!auction) return null;

  const joinedTeamsCount = auction.teams.filter((t) => t.ownerSessionId).length;
  const canStartAuction = isAdmin && joinedTeamsCount >= 2;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-blue-800">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-2xl p-6 mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-800 mb-2">{auction.name}</h1>
              <div className="flex items-center gap-4 text-gray-600">
                <span>
                  {joinedTeamsCount} / 10 teams joined
                </span>
                {auction.type === 'private' && auction.roomCode && (
                  <span className="bg-purple-100 text-purple-700 px-4 py-1 rounded-full font-mono font-bold">
                    Room: {auction.roomCode}
                  </span>
                )}
                {isAdmin && (
                  <span className="bg-yellow-100 text-yellow-700 px-4 py-1 rounded-full font-bold">
                    👑 Admin
                  </span>
                )}
              </div>
            </div>
            {isAdmin && (
              <button
                onClick={handleStartAuction}
                disabled={!canStartAuction || startingAuction}
                className="bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 transition-colors font-bold disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {startingAuction ? 'Starting...' : 'Start Auction'}
              </button>
            )}
          </div>

          {error && (
            <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {!canStartAuction && isAdmin && (
            <div className="mt-4 bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
              At least 2 teams must join to start the auction
            </div>
          )}
        </div>

        {/* Selected Team Highlight */}
        {selectedTeam && (
          <div className="bg-white rounded-xl shadow-2xl p-6 mb-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Team</h2>
            <div className="flex items-center gap-4">
              <div
                className={`w-16 h-16 ${
                  TEAM_COLORS[selectedTeam.teamName]?.primary || 'bg-gray-600'
                } rounded-lg flex items-center justify-center`}
              >
                <span className="text-white text-2xl font-bold">
                  {selectedTeam.teamName}
                </span>
              </div>
              <div>
                <h3 className="text-xl font-bold">{selectedTeam.teamName}</h3>
                <p className="text-gray-600">
                  ₹{Number(selectedTeam.purseRemainingCr).toFixed(2)} cr • {selectedTeam.playerCount}{' '}
                  players • {selectedTeam.rtmCardsTotal} RTM cards
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Team Selection Grid */}
        <div className="bg-white rounded-xl shadow-2xl p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            {selectedTeam ? 'All Teams' : 'Select Your Team'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {auction.teams.map((team) => {
              const isOwned = team.ownerSessionId !== null;
              const isMyTeam = team.ownerSessionId === sessionId;
              const teamColor = TEAM_COLORS[team.teamName] || {
                primary: 'bg-gray-600',
                secondary: 'border-gray-600',
              };

              return (
                <div
                  key={team.id}
                  className={`border-2 rounded-xl p-6 transition-all ${
                    isMyTeam
                      ? `${teamColor.secondary} bg-opacity-10 scale-105 shadow-xl`
                      : isOwned
                      ? 'border-gray-300 bg-gray-100 opacity-60'
                      : 'border-gray-200 hover:border-purple-500 hover:shadow-lg cursor-pointer'
                  }`}
                  onClick={() => !isOwned && !selectedTeam && handleSelectTeam(team)}
                >
                  {/* Team Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div
                      className={`w-12 h-12 ${teamColor.primary} rounded-lg flex items-center justify-center`}
                    >
                      <span className="text-white text-xl font-bold">{team.teamName}</span>
                    </div>
                    {isOwned && (
                      <span
                        className={`${
                          isMyTeam ? 'bg-green-500' : 'bg-gray-500'
                        } text-white px-3 py-1 rounded-full text-sm font-bold`}
                      >
                        {isMyTeam ? 'YOU' : 'TAKEN'}
                      </span>
                    )}
                  </div>

                  {/* Team Stats */}
                  <h3 className="text-xl font-bold text-gray-800 mb-3">{team.teamName}</h3>

                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex justify-between">
                      <span>Purse Remaining:</span>
                      <span className="font-bold text-green-600">
                        ₹{Number(team.purseRemainingCr).toFixed(2)} cr
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Players:</span>
                      <span className="font-bold">{team.playerCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Overseas:</span>
                      <span className="font-bold">{team.overseasCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>RTM Cards:</span>
                      <span className="font-bold">{team.rtmCardsTotal}</span>
                    </div>
                  </div>

                  {/* Retained Players */}
                  {team.retainedPlayers && team.retainedPlayers.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 mb-2">RETAINED:</p>
                      <div className="space-y-1">
                        {team.retainedPlayers.slice(0, 3).map((player, idx) => (
                          <div key={idx} className="text-xs text-gray-700 flex justify-between">
                            <span className="truncate">{player.name}</span>
                            <span className="font-bold ml-2">₹{Number(player.priceCr).toFixed(1)}cr</span>
                          </div>
                        ))}
                        {team.retainedPlayers.length > 3 && (
                          <div className="text-xs text-gray-500">
                            +{team.retainedPlayers.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Instructions */}
        {!selectedTeam && (
          <div className="mt-8 bg-white bg-opacity-10 backdrop-blur-sm rounded-xl p-6 text-white text-center">
            <p className="text-lg">
              👆 Select a team to join the auction. Waiting for other players...
            </p>
          </div>
        )}

        {selectedTeam && !isAdmin && (
          <div className="mt-8 bg-white bg-opacity-10 backdrop-blur-sm rounded-xl p-6 text-white text-center">
            <p className="text-lg">
              ⏳ Waiting for admin to start the auction...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
