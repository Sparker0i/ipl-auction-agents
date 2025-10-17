import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auctionApi, sessionApi } from '../services/api';

export default function HomePage() {
  const navigate = useNavigate();
  const [auctionName, setAuctionName] = useState('');
  const [auctionType, setAuctionType] = useState<'public' | 'private'>('private');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateAuction = async () => {
    if (!auctionName.trim()) {
      setError('Please enter an auction name');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await auctionApi.createAuction({
        name: auctionName,
        type: auctionType,
      });

      // Store admin token
      sessionApi.setAdminToken(response.auctionId, response.adminToken);

      // Navigate to lobby
      navigate(`/lobby/${response.auctionId}`);
    } catch (err: any) {
      console.error('Failed to create auction:', err);
      setError(err.response?.data?.message || 'Failed to create auction');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinAuction = async () => {
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const auction = await auctionApi.getAuctionByRoomCode(roomCode.toUpperCase());

      // Navigate to lobby
      navigate(`/lobby/${auction.id}`);
    } catch (err: any) {
      console.error('Failed to join auction:', err);
      setError(err.response?.data?.message || 'Invalid room code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-blue-800">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold text-white mb-4">
            IPL Auction Platform
          </h1>
          <p className="text-xl text-gray-300">
            Build your dream team with 574 players • Real-time bidding • RTM mechanics
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="max-w-2xl mx-auto mb-6 bg-red-500 text-white px-6 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Main Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
          {/* Create Auction Card */}
          <div className="bg-white p-8 rounded-xl shadow-2xl">
            <div className="flex items-center mb-6">
              <div className="w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center mr-4">
                <span className="text-2xl">🏏</span>
              </div>
              <h2 className="text-3xl font-bold text-gray-800">Create Auction</h2>
            </div>

            <p className="text-gray-600 mb-6">
              Start a new IPL auction simulation with your friends
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Auction Name
                </label>
                <input
                  type="text"
                  value={auctionName}
                  onChange={(e) => setAuctionName(e.target.value)}
                  placeholder="e.g., IPL 2025 Mega Auction"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Auction Type
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="private"
                      checked={auctionType === 'private'}
                      onChange={(e) => setAuctionType(e.target.value as 'private')}
                      className="mr-2"
                      disabled={loading}
                    />
                    <span className="text-gray-700">Private (Room Code)</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="public"
                      checked={auctionType === 'public'}
                      onChange={(e) => setAuctionType(e.target.value as 'public')}
                      className="mr-2"
                      disabled={loading}
                    />
                    <span className="text-gray-700">Public</span>
                  </label>
                </div>
              </div>

              <button
                onClick={handleCreateAuction}
                disabled={loading}
                className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating...' : 'Create Auction'}
              </button>
            </div>
          </div>

          {/* Join Auction Card */}
          <div className="bg-white p-8 rounded-xl shadow-2xl">
            <div className="flex items-center mb-6">
              <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mr-4">
                <span className="text-2xl">🎯</span>
              </div>
              <h2 className="text-3xl font-bold text-gray-800">Join Auction</h2>
            </div>

            <p className="text-gray-600 mb-6">
              Enter a room code to join an existing auction
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Room Code
                </label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="e.g., ABC123"
                  maxLength={6}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-center text-2xl font-mono tracking-widest uppercase focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                  disabled={loading}
                />
                <p className="text-sm text-gray-500 mt-2">
                  Enter the 6-character room code
                </p>
              </div>

              <button
                onClick={handleJoinAuction}
                disabled={loading}
                className="w-full bg-yellow-500 text-white px-6 py-3 rounded-lg hover:bg-yellow-600 transition-colors font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? 'Joining...' : 'Join Auction'}
              </button>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="mt-16 max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white bg-opacity-10 backdrop-blur-sm p-6 rounded-lg text-white">
              <h3 className="text-xl font-bold mb-2">574 Players</h3>
              <p className="text-gray-300">Complete IPL 2024 player database with all roles and base prices</p>
            </div>
            <div className="bg-white bg-opacity-10 backdrop-blur-sm p-6 rounded-lg text-white">
              <h3 className="text-xl font-bold mb-2">Real-time Bidding</h3>
              <p className="text-gray-300">Live auction with instant bid updates and RTM mechanics</p>
            </div>
            <div className="bg-white bg-opacity-10 backdrop-blur-sm p-6 rounded-lg text-white">
              <h3 className="text-xl font-bold mb-2">Admin Controls</h3>
              <p className="text-gray-300">Full auction management with player progression and round transitions</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
