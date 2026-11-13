import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { AlertTriangle, Layers, MapPin, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState } from '../components/common/DataState';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
import { useTheme } from '../context/ThemeContext';
import {
  ApiSuccessResponse,
  AtmClusterRow,
  AtmHeatmapRow,
  AtmPredictionRow,
  AtmWithdrawalRow,
  ComplaintSummary,
  PredictionWindow,
  RiskLevel,
} from '../types';
import { formatInr, formatShortTime } from '../utils/formatters';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DEFAULT_LIGHT_TILES =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const DEFAULT_DARK_TILES =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const FALLBACK_ESRI_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

function riskColorHex(level: string, theme: 'light' | 'dark'): string {
  if (level === 'Critical') return theme === 'light' ? '#DC2626' : '#EF4444';
  if (level === 'High') return theme === 'light' ? '#D97706' : '#F59E0B';
  if (level === 'Medium') return theme === 'light' ? '#3489E8' : '#38BDF8';
  return '#10B981';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface DisplayedAtmItem {
  atm_id: string;
  bank: string;
  address: string;
  locality: string;
  city: string;
  lat: number;
  lng: number;
  risk_score: number;
  risk_level: RiskLevel;
  window: PredictionWindow;
  prediction_count: number;
  withdrawal_count: number;
  score_source: string | null;
  subtitle: string;
  linked_accounts: Array<{
    account_number: string;
    holder_name?: string;
    retained_amount?: number;
  }>;
  relevant_paths: Array<{
    path: string[];
    total_amount: number;
  }>;
}

export function GeospatialMapPage() {
  const { theme } = useTheme();
  const [searchParams] = useSearchParams();
  const initialComplaintId = searchParams.get('complaintId') || '';

  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [selectedComplaintId, setSelectedComplaintId] = useState<string>(initialComplaintId);
  const [riskFilter, setRiskFilter] = useState<RiskLevel | ''>('');
  const [windowFilter, setWindowFilter] = useState<PredictionWindow | ''>('');
  const [showClusters, setShowClusters] = useState<boolean>(true);
  const [showWithdrawals, setShowWithdrawals] = useState<boolean>(false);

  const [heatmapRows, setHeatmapRows] = useState<AtmHeatmapRow[]>([]);
  const [casePredictions, setCasePredictions] = useState<AtmPredictionRow[]>([]);
  const [clusters, setClusters] = useState<AtmClusterRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<AtmWithdrawalRow[]>([]);

  const [selectedAtmId, setSelectedAtmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tileNotice, setTileNotice] = useState<string | null>(null);
  const [tileProviderLabel, setTileProviderLabel] = useState<string>('CARTO Basemap');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());

  const loadGeoData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const requests: Promise<unknown>[] = [
        apiRequest<ApiSuccessResponse<AtmHeatmapRow[]>>('/predictions/atm/heatmap'),
        apiRequest<ApiSuccessResponse<{ clusters: AtmClusterRow[] }>>('/ml/clusters/atms').catch(
          () => ({ success: true, data: { clusters: [] } })
        ),
        apiRequest<ApiSuccessResponse<AtmWithdrawalRow[]>>('/atms/withdrawals?limit=40'),
      ];

      if (selectedComplaintId) {
        const params = new URLSearchParams({ complaintId: selectedComplaintId, limit: '30' });
        if (riskFilter) params.set('riskLevel', riskFilter);
        if (windowFilter) params.set('window', windowFilter);
        requests.push(
          apiRequest<ApiSuccessResponse<{ predictions: AtmPredictionRow[] }>>(
            `/predictions/atm?${params.toString()}`
          )
        );
      }

      const [heatRes, clusRes, wdRes, predRes] = (await Promise.all(requests)) as [
        ApiSuccessResponse<AtmHeatmapRow[]>,
        ApiSuccessResponse<{ clusters: AtmClusterRow[] }>,
        ApiSuccessResponse<AtmWithdrawalRow[]>,
        ApiSuccessResponse<{ predictions: AtmPredictionRow[] }> | undefined,
      ];

      setHeatmapRows(heatRes.data);
      setClusters(clusRes.data.clusters ?? []);
      setWithdrawals(wdRes.data);
      setCasePredictions(predRes ? predRes.data.predictions : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load ATM GIS data.');
    } finally {
      setLoading(false);
    }
  }, [selectedComplaintId, riskFilter, windowFilter]);

  useEffect(() => {
    apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50')
      .then((res) => setComplaints(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadGeoData();
  }, [loadGeoData]);

  // Unified markers list (case-specific if complaint selected, otherwise global heatmap)
  const displayedAtms: DisplayedAtmItem[] = useMemo(() => {
    if (selectedComplaintId) {
      return casePredictions
        .filter((p) => (!riskFilter ? true : p.risk_level === riskFilter))
        .filter((p) => (!windowFilter ? true : p.window === windowFilter))
        .map((p) => ({
          atm_id: p.atm_id,
          bank: p.bank,
          address: p.address,
          locality: p.locality,
          city: p.city,
          lat: Number(p.lat),
          lng: Number(p.lng),
          risk_score: Number(p.risk_score),
          risk_level: p.risk_level,
          window: p.window,
          prediction_count: 1,
          withdrawal_count: 0,
          score_source: p.score_source,
          subtitle: `Rank #${p.rank_order} · ${p.complaint_number ?? 'Linked Case'}`,
          linked_accounts: p.linked_accounts_json ?? [],
          relevant_paths: p.relevant_paths_json ?? [],
        }));
    }

    return heatmapRows
      .filter((h) => (!riskFilter ? true : h.peak_risk_level === riskFilter))
      .filter((h) => (!windowFilter ? true : h.peak_window === windowFilter))
      .map((h) => ({
        atm_id: h.atm_id,
        bank: h.bank,
        address: h.address,
        locality: h.locality,
        city: h.city,
        lat: Number(h.lat),
        lng: Number(h.lng),
        risk_score: Number(h.max_risk_score),
        risk_level: h.peak_risk_level,
        window: h.peak_window,
        prediction_count: Number(h.prediction_count ?? 0),
        withdrawal_count: Number(h.withdrawal_count ?? 0),
        score_source: null,
        subtitle: `${h.prediction_count} active predictions · ${h.withdrawal_count} historical cash-outs`,
        linked_accounts: h.top_linked_accounts ?? [],
        relevant_paths: h.top_relevant_paths ?? [],
      }));
  }, [selectedComplaintId, casePredictions, heatmapRows, riskFilter, windowFilter]);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [12.9716, 77.5946], // Bengaluru centroid
      zoom: 12,
      zoomControl: true,
    });

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Swap theme-aware basemap TileLayer cleanly + handle tileerror fallback
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    setTileNotice(null);
    const configuredLightUrl =
      (import.meta.env.VITE_MAP_TILE_URL as string | undefined)?.trim() || DEFAULT_LIGHT_TILES;
    const primaryUrl =
      theme === 'dark'
        ? configuredLightUrl !== DEFAULT_LIGHT_TILES && configuredLightUrl.includes('voyager')
          ? configuredLightUrl.replace('voyager', 'dark_all')
          : DEFAULT_DARK_TILES
        : configuredLightUrl;

    setTileProviderLabel(theme === 'dark' ? 'CARTO Dark Matter' : 'CARTO Voyager');

    let usingFallback = false;
    let primaryErrorCount = 0;
    let fallbackErrorCount = 0;

    const attachFallbackLayer = () => {
      if (usingFallback || !mapRef.current) return;
      usingFallback = true;
      if (tileLayerRef.current) {
        mapRef.current.removeLayer(tileLayerRef.current);
      }
      setTileProviderLabel('Esri World Street Map (Fallback)');
      const fallbackLayer = L.tileLayer(FALLBACK_ESRI_TILES, {
        attribution: 'Tiles © Esri — Source: Esri, HERE, Garmin, OpenStreetMap',
        maxZoom: 19,
        referrerPolicy: 'origin',
      } as L.TileLayerOptions);

      fallbackLayer.on('tileerror', () => {
        fallbackErrorCount += 1;
        if (fallbackErrorCount >= 3) {
          setTileNotice(
            'Basemap tiles could not be loaded in this environment. Plotted ATM markers, coordinates, and DBSCAN clusters remain interactive below.'
          );
        }
      });

      fallbackLayer.addTo(mapRef.current);
      tileLayerRef.current = fallbackLayer;
    };

    const primaryLayer = L.tileLayer(primaryUrl, {
      attribution: '© OpenStreetMap contributors © CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
      referrerPolicy: 'origin',
    } as L.TileLayerOptions);

    primaryLayer.on('tileerror', () => {
      primaryErrorCount += 1;
      if (!usingFallback && primaryErrorCount >= 3) {
        attachFallbackLayer();
      }
    });

    primaryLayer.addTo(map);
    tileLayerRef.current = primaryLayer;

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 220);

    return () => {
      clearTimeout(timer);
    };
  }, [theme]);

  // Sync markers, DBSCAN hotspot circles, and withdrawals
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    markersRef.current.clear();

    if (showClusters) {
      const clusterStroke = theme === 'light' ? '#D97706' : '#F59E0B';
      clusters.forEach((cl) => {
        L.circle([cl.centroid_lat, cl.centroid_lng], {
          radius: 1800,
          color: clusterStroke,
          weight: 1.5,
          dashArray: '4 4',
          fillColor: clusterStroke,
          fillOpacity: theme === 'light' ? 0.14 : 0.12,
        })
          .bindPopup(
            `<div style="font-family:sans-serif;font-size:12px;">
              <strong>DBSCAN Cluster #${cl.cluster_id}</strong><br/>
              ATMs: ${cl.atm_count} (${escapeHtml(cl.localities.join(', '))})<br/>
              Flagged Cash-Outs: ${cl.flagged_cashouts} / ${cl.total_withdrawals}
            </div>`
          )
          .addTo(group);
      });
    }

    if (showWithdrawals) {
      withdrawals.forEach((wd) => {
        L.circleMarker([Number(wd.lat), Number(wd.lng)], {
          radius: 5,
          color: wd.is_flagged_cashout ? '#DC2626' : '#64748B',
          weight: 1.5,
          fillColor: wd.is_flagged_cashout ? '#EF4444' : '#94A3B8',
          fillOpacity: 0.75,
        })
          .bindPopup(
            `<div style="font-family:sans-serif;font-size:12px;">
              <strong>Historical Withdrawal (${escapeHtml(wd.atm_id)})</strong><br/>
              ${escapeHtml(wd.account_number)} · ${escapeHtml(formatInr(wd.amount))}<br/>
              ${escapeHtml(formatShortTime(wd.withdrawn_at))}
            </div>`
          )
          .addTo(group);
      });
    }

    const boundsPoints: L.LatLngExpression[] = [];
    displayedAtms.forEach((atm) => {
      if (!Number.isFinite(atm.lat) || !Number.isFinite(atm.lng)) return;
      boundsPoints.push([atm.lat, atm.lng]);

      const color = riskColorHex(atm.risk_level, theme);
      const hasPrediction = !(atm.risk_score === 0 && atm.prediction_count === 0);
      const radius = hasPrediction ? Math.max(7, Math.min(16, 6 + atm.risk_score / 11)) : 7;
      const isSelected = selectedAtmId === atm.atm_id;
      const selectedRing = theme === 'light' ? '#172B4D' : '#FFFFFF';

      const marker = L.circleMarker([atm.lat, atm.lng], {
        radius: isSelected ? radius + 3 : radius,
        color: isSelected ? selectedRing : color,
        weight: isSelected ? 3 : 2,
        fillColor: color,
        fillOpacity: atm.risk_score > 0 ? 0.8 : 0.45,
      });

      const scoreText = hasPrediction
        ? `<strong>${atm.risk_score.toFixed(1)}/100</strong> (${escapeHtml(atm.risk_level)})`
        : '<strong>No active prediction</strong>';

      const accountsHtml =
        atm.linked_accounts.length > 0
          ? `<div style="margin-top:6px;">
              <strong>Linked Accounts:</strong><br/>
              ${atm.linked_accounts
                .slice(0, 3)
                .map(
                  (acc) =>
                    `<span style="font-family:monospace;font-size:11px;">• ${escapeHtml(
                      acc.account_number
                    )}${acc.holder_name ? ` (${escapeHtml(acc.holder_name)})` : ''}</span>`
                )
                .join('<br/>')}
            </div>`
          : '';

      const pathsHtml =
        atm.relevant_paths.length > 0
          ? `<div style="margin-top:6px;">
              <strong>Linked Transactions / Flow:</strong><br/>
              ${atm.relevant_paths
                .slice(0, 2)
                .map(
                  (rp) =>
                    `<span style="font-family:monospace;font-size:11px;">• ${escapeHtml(
                      rp.path.join(' → ')
                    )} (${escapeHtml(formatInr(rp.total_amount))})</span>`
                )
                .join('<br/>')}
            </div>`
          : '';

      marker.bindPopup(
        `<div style="font-family:sans-serif;font-size:12px;min-width:220px;max-width:290px;">
          <strong>${escapeHtml(atm.atm_id)} · ${escapeHtml(atm.bank)}</strong><br/>
          <span>${escapeHtml(atm.locality)} — ${escapeHtml(atm.address)}</span><br/>
          <hr style="margin:6px 0;border-color:#94a3b8;opacity:0.35;"/>
          <span>Risk Score: ${scoreText}</span><br/>
          <span>Window: <strong>${escapeHtml(atm.window)}</strong></span><br/>
          <span style="opacity:0.8;">${escapeHtml(atm.subtitle)}</span>
          ${accountsHtml}
          ${pathsHtml}
        </div>`
      );

      marker.on('click', () => {
        setSelectedAtmId(atm.atm_id);
        map.flyTo([atm.lat, atm.lng], Math.max(map.getZoom(), 14), { duration: 0.5 });
      });

      marker.addTo(group);
      markersRef.current.set(atm.atm_id, marker);

      if (isSelected) {
        marker.openPopup();
      }
    });

    if (boundsPoints.length > 0 && !selectedAtmId) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [32, 32], maxZoom: 13 });
    }
  }, [displayedAtms, clusters, withdrawals, showClusters, showWithdrawals, selectedAtmId, theme]);

  const focusAtmOnMap = (atm: DisplayedAtmItem) => {
    setSelectedAtmId(atm.atm_id);
    mapRef.current?.flyTo([atm.lat, atm.lng], 14, { duration: 0.6 });
    const marker = markersRef.current.get(atm.atm_id);
    if (marker) {
      marker.openPopup();
    }
  };

  return (
    <CommandLayout
      title="GIS ATM Hotspot & Cash-Out Map"
      section="Intelligence Engines"
      actions={
        <button
          type="button"
          onClick={() => void loadGeoData()}
          className="inline-flex items-center gap-1.5 rounded-[5px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh Map
        </button>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadGeoData()} /> : null}

      {tileNotice ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[6px] border border-amber-400/50 bg-[#FEF3C7] px-4 py-2.5 text-xs text-[#92400E] dark:border-amber-500/40 dark:bg-amber-950/35 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{tileNotice}</span>
        </div>
      ) : null}

      {/* Map Filters */}
      <section className="rounded-[6px] border border-border-subtle bg-card p-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-center">
          <div className="lg:col-span-2">
            <select
              value={selectedComplaintId}
              onChange={(e) => {
                setSelectedAtmId(null);
                setSelectedComplaintId(e.target.value);
              }}
              aria-label="Filter map by complaint"
              className="w-full rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none"
            >
              <option value="">Global ATM Risk Heatmap (All Cases)</option>
              {complaints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.complaint_number} · {c.victim_name}
                </option>
              ))}
            </select>
          </div>

          <select
            value={riskFilter}
            onChange={(e) => {
              setSelectedAtmId(null);
              setRiskFilter(e.target.value as RiskLevel | '');
            }}
            aria-label="Filter by risk level"
            className="rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none"
          >
            <option value="">All Risk Levels</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          <select
            value={windowFilter}
            onChange={(e) => {
              setSelectedAtmId(null);
              setWindowFilter(e.target.value as PredictionWindow | '');
            }}
            aria-label="Filter by window"
            className="rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none"
          >
            <option value="">All Windows</option>
            <option value="0-6h">0-6h</option>
            <option value="6-12h">6-12h</option>
            <option value="12-24h">12-24h</option>
            <option value=">24h">&gt;24h</option>
          </select>

          <div className="flex items-center gap-4 text-xs text-body">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showClusters}
                onChange={(e) => setShowClusters(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border-strong bg-subtle accent-accent-strong"
              />
              DBSCAN Clusters
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showWithdrawals}
                onChange={(e) => setShowWithdrawals(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border-strong bg-subtle accent-accent-strong"
              />
              Past Cash-Outs
            </label>
          </div>
        </div>
      </section>

      {/* Map + Terminal Sidebar */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 rounded-[6px] border border-border-subtle bg-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-accent-strong" aria-hidden="true" />
              <span className="font-semibold text-heading">
                Spatial Intelligence Map · {tileProviderLabel}
              </span>
            </div>
            <span className="font-mono text-[11px] text-muted tabular-nums">
              {displayedAtms.length} ATMs · {clusters.length} DBSCAN clusters
            </span>
          </div>

          <div ref={mapContainerRef} className="h-[calc(100vh-280px)] min-h-[480px] w-full z-10" />

          <div className="flex flex-wrap items-center gap-4 border-t border-border-subtle bg-subtle px-4 py-2 text-[11px] text-body">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: 'var(--risk-critical-marker)' }}
              />
              Critical (80–100)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: 'var(--risk-high-marker)' }}
              />
              High (65–79)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: 'var(--risk-medium-marker)' }}
              />
              Medium (45–64)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: 'var(--risk-low-marker)' }}
              />
              Low / Baseline
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border border-amber-500 bg-amber-400/30" />
              DBSCAN Hotspot Zone (1.8 km)
            </span>
          </div>
        </div>

        <div className="xl:col-span-4 rounded-[6px] border border-border-subtle bg-card flex flex-col overflow-hidden">
          <div className="border-b border-border-subtle bg-subtle px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-heading">Plotted ATM Terminals</h2>
            </div>
            <span className="font-mono text-xs text-muted tabular-nums">
              {displayedAtms.length}
            </span>
          </div>

          <div className="divide-y divide-border-subtle overflow-y-auto max-h-[calc(100vh-270px)] min-h-[480px]">
            {displayedAtms.length === 0 ? (
              <EmptyDataState
                title="No ATM markers match filters"
                description="Clear risk or window filters to display all Bengaluru ATM terminals."
              />
            ) : (
              displayedAtms.map((atm) => {
                const isSelected = selectedAtmId === atm.atm_id;
                const hasPrediction = !(atm.risk_score === 0 && atm.prediction_count === 0);
                return (
                  <button
                    key={atm.atm_id}
                    type="button"
                    onClick={() => focusAtmOnMap(atm)}
                    className={`w-full px-4 py-3 text-left space-y-1.5 cursor-pointer transition-colors ${
                      isSelected ? 'bg-highlight' : 'hover:bg-subtle'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-heading truncate">
                          {atm.atm_id} · {atm.bank} ({atm.locality})
                        </p>
                        <p className="text-[11px] text-muted truncate">{atm.address}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {hasPrediction ? (
                          <p className="font-mono text-sm font-bold text-heading tabular-nums">
                            {atm.risk_score.toFixed(1)}/100
                          </p>
                        ) : (
                          <p className="text-[11px] font-semibold text-muted">
                            No active prediction
                          </p>
                        )}
                        <StatusSignal level={atm.risk_level} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-amber-700 dark:text-amber-300">
                        Window: {atm.window}
                      </span>
                      {atm.score_source ? (
                        <ScoreSourceBadge source={atm.score_source} />
                      ) : (
                        <span className="text-muted truncate">{atm.subtitle}</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </section>
    </CommandLayout>
  );
}
