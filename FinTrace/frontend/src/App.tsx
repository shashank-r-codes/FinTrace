import { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AiAssistantPage } from './pages/AiAssistantPage';
import { AlertsCentrePage } from './pages/AlertsCentrePage';
import { AtmPredictionPage } from './pages/AtmPredictionPage';
import { ComplaintsPage } from './pages/ComplaintsPage';
import { DashboardPage } from './pages/DashboardPage';
import { EvidencePage } from './pages/EvidencePage';
import { FraudDetectionPage } from './pages/FraudDetectionPage';
import { GeospatialMapPage } from './pages/GeospatialMapPage';
import { InvestigationsPage } from './pages/InvestigationsPage';
import { LoginPage } from './pages/LoginPage';
import { NetworkGraphPage } from './pages/NetworkGraphPage';
import { ReportsAnalyticsPage } from './pages/ReportsAnalyticsPage';
import { SettingsUsersPage } from './pages/SettingsUsersPage';
import { TransactionExplorerPage } from './pages/TransactionExplorerPage';
import { UserRole } from './types';

function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: UserRole[];
}) {
  const { user, loading, hasRole } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-xs font-mono text-slate-400">
        Restoring FinTrace investigator session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !hasRole(...roles)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/complaints"
            element={
              <ProtectedRoute>
                <ComplaintsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transactions"
            element={
              <ProtectedRoute>
                <TransactionExplorerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/graph"
            element={
              <ProtectedRoute>
                <NetworkGraphPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fraud-ml"
            element={
              <ProtectedRoute>
                <FraudDetectionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/atm-predictions"
            element={
              <ProtectedRoute>
                <AtmPredictionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/map"
            element={
              <ProtectedRoute>
                <GeospatialMapPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/alerts"
            element={
              <ProtectedRoute>
                <AlertsCentrePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/investigations"
            element={
              <ProtectedRoute roles={['Administrator', 'Senior Investigator', 'Investigator']}>
                <InvestigationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/evidence"
            element={
              <ProtectedRoute roles={['Administrator', 'Senior Investigator', 'Investigator']}>
                <EvidencePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute roles={['Administrator', 'Senior Investigator', 'Investigator']}>
                <ReportsAnalyticsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assistant"
            element={
              <ProtectedRoute roles={['Administrator', 'Senior Investigator', 'Investigator']}>
                <AiAssistantPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute roles={['Administrator', 'Senior Investigator']}>
                <SettingsUsersPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
