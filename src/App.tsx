import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { GameLayout } from './GameLayout';
import { GalaxyPage } from './GalaxyPage';
import { SectorView } from './SectorView';
import { ClansPage } from './clans/ClansPage';
import { ClanDetailView } from './clans/ClanDetailView';
import { BountiesPage } from './bounties/BountiesPage';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<GameLayout />}>
          <Route index element={<Navigate to="/sector" replace />} />
          <Route path="/sector" element={<SectorView />} />
          <Route path="/galaxy" element={<GalaxyPage />} />
          <Route path="/clans" element={<ClansPage />} />
          <Route path="/clans/:id" element={<ClanDetailView />} />
          <Route path="/bounties" element={<BountiesPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
