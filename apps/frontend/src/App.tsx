import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import AuctionPage from './pages/AuctionPage';
import DashboardPage from './pages/DashboardPage';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/lobby/:auctionId" element={<LobbyPage />} />
        <Route path="/auction/:auctionId" element={<AuctionPage />} />
        <Route path="/dashboard/:auctionId" element={<DashboardPage />} />
      </Routes>
    </div>
  );
}

export default App;
