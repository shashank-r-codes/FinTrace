import { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AccountIntelligencePage } from './pages/AccountIntelligencePage';
import { AiAssistantPage } from './pages/AiAssistantPage';
import { AlertsCentrePage } from './pages/AlertsCentrePage';
import { AtmPredictionPage } from './pages/AtmPredictionPage';
import { CitizenComplaintStatusPage } from './pages/citizen/CitizenComplaintStatusPage';
import { CitizenDashboardPage } from './pages/citizen/CitizenDashboardPage';
import { CitizenProfilePage } from './pages/citizen/CitizenProfilePage';
import { FileComplaintPage } from './pages/citizen/FileComplaintPage';
import { MyComplaintsPage } from './pages/citizen/MyComplaintsPage';
import { ComplaintsPage } from './pages/ComplaintsPage';
import { DashboardPage } from './pages/DashboardPage';
import { EvidencePage } from './pages/EvidencePage';
import { FraudDetectionPage } from './pages/FraudDetectionPage';
import { GeospatialMapPage } from './pages/GeospatialMapPage';
import { InterventionCentrePage } from './pages/InterventionCentrePage';
import { InvestigationsPage } from './pages/InvestigationsPage';
import { LoginPage } from './pages/LoginPage';
import { MuleSyndicatesPage } from './pages/MuleSyndicatesPage';
import { NetworkGraphPage } from './pages/NetworkGraphPage';
import { PreventionSimulatorPage } from './pages/PreventionSimulatorPage';
import { RealTimeScreeningPage } from './pages/RealTimeScreeningPage';
import { ReportsAnalyticsPage } from './pages/ReportsAnalyticsPage';
import { SettingsUsersPage } from './pages/SettingsUsersPage';
import { TransactionExplorerPage } from './pages/TransactionExplorerPage';
import { UserRole } from './types';

function OfficerRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: UserRole[];
}) {
  const { user, loading, hasRole } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center text-xs font-mono text-muted">
        Restoring FinTrace session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'citizen') {
    return <Navigate to="/citizen" replace />;
  }

  if (roles && !hasRole(...roles)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function CitizenRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center text-xs font-mono text-muted">
        Restoring FinTrace citizen session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'citizen') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function CatchAllRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'citizen' ? '/citizen' : '/'} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Citizen Portal Routes (Strictly isolated) */}
            <Route
              path="/citizen"
              element={
                <CitizenRoute>
                  <CitizenDashboardPage />
                </CitizenRoute>
              }
            />
            <Route
              path="/citizen/file"
              element={
                <CitizenRoute>
                  <FileComplaintPage />
                </CitizenRoute>
              }
            />
            <Route
              path="/citizen/complaints"
              element={
                <CitizenRoute>
                  <MyComplaintsPage />
                </CitizenRoute>
              }
            />
            <Route
              path="/citizen/complaints/:id"
              element={
                <CitizenRoute>
                  <CitizenComplaintStatusPage />
                </CitizenRoute>
              }
            />
            <Route
              path="/citizen/profile"
              element={
                <CitizenRoute>
                  <CitizenProfilePage />
                </CitizenRoute>
              }
            />

            {/* Officer Command Centre Routes */}
            <Route
              path="/"
              element={
                <OfficerRoute>
                  <DashboardPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/complaints"
              element={
                <OfficerRoute>
                  <ComplaintsPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/transactions"
              element={
                <OfficerRoute>
                  <TransactionExplorerPage />
                </OfficerRoute>
              }
            />

            {/* Fraud Prevention Layer */}
            <Route
              path="/accounts/intelligence"
              element={
                <OfficerRoute>
                  <AccountIntelligencePage />
                </OfficerRoute>
              }
            />
            <Route
              path="/screening"
              element={
                <OfficerRoute>
                  <RealTimeScreeningPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/interventions"
              element={
                <OfficerRoute>
                  <InterventionCentrePage />
                </OfficerRoute>
              }
            />
            <Route
              path="/mule-clusters"
              element={
                <OfficerRoute>
                  <MuleSyndicatesPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/prevention-simulator"
              element={
                <OfficerRoute>
                  <PreventionSimulatorPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/graph"
              element={
                <OfficerRoute>
                  <NetworkGraphPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/fraud-ml"
              element={
                <OfficerRoute>
                  <FraudDetectionPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/atm-predictions"
              element={
                <OfficerRoute>
                  <AtmPredictionPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/map"
              element={
                <OfficerRoute>
                  <GeospatialMapPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/alerts"
              element={
                <OfficerRoute>
                  <AlertsCentrePage />
                </OfficerRoute>
              }
            />
            <Route
              path="/investigations"
              element={
                <OfficerRoute roles={['Administrator', 'Senior Investigator', 'Investigator']}>
                  <InvestigationsPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/evidence"
              element={
                <OfficerRoute roles={['Administrator', 'Senior Investigator', 'Investigator']}>
                  <EvidencePage />
                </OfficerRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <OfficerRoute roles={['Administrator', 'Senior Investigator', 'Investigator']}>
                  <ReportsAnalyticsPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/assistant"
              element={
                <OfficerRoute roles={['Administrator', 'Senior Investigator', 'Investigator']}>
                  <AiAssistantPage />
                </OfficerRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <OfficerRoute roles={['Administrator', 'Senior Investigator']}>
                  <SettingsUsersPage />
                </OfficerRoute>
              }
            />

            <Route path="*" element={<CatchAllRedirect />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  </ErrorBoundary>
  );
}
