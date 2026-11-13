import L from 'leaflet';
import { Layers, MapPin, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState } from '../components/common/DataState';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
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

function riskColorHex(level: string): string {
  if (level === 'Critical') return '#EF4444';
  if (level === 'High') return '#F59E0B';
  if (level === 'Medium') return '#38BDF8';
  return '#64748B';
}

export function GeospatialMapPage() {
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

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

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
  const displayedAtms = useMemo(() => {
    if (selectedComplaintId) {
      return casePredictions.map((p) => ({
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
        score_source: p.score_source,
        subtitle: `Rank #${p.rank_order} · ${p.complaint_number ?? 'Linked Case'}`,
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
        score_source: null as string | null,
        subtitle: `${h.prediction_count} active predictions · ${h.withdrawal_count} historical cash-outs`,
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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Sync markers, DBSCAN hotspot circles, and withdrawals
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (showClusters) {
      clusters.forEach((cl) => {
        L.circle([cl.centroid_lat, cl.centroid_lng], {
          radius: 1800,
          color: '#F59E0B',
          weight: 1.5,
          dashArray: '4 4',
          fillColor: '#F59E0B',
          fillOpacity: 0.12,
        })
          .bindPopup(
            `<div style="font-family:sans-serif;font-size:12px;">
              <strong>DBSCAN Cluster #${cl.cluster_id}</strong><br/>
              ATMs: ${cl.atm_count} (${cl.localities.join(', ')})<br/>
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
          color: wd.is_flagged_cashout ? '#F43F5E' : '#94A3B8',
          weight: 1.5,
          fillColor: wd.is_flagged_cashout ? '#F43F5E' : '#94A3B8',
          fillOpacity: 0.7,
        })
          .bindPopup(
            `<div style="font-family:sans-serif;font-size:12px;">
              <strong>Historical Withdrawal (${wd.atm_id})</strong><br/>
              ${wd.account_number} · ${formatInr(wd.amount)}<br/>
              ${formatShortTime(wd.withdrawn_at)}
            </div>`
          )
          .addTo(group);
      });
    }

    const boundsPoints: L.LatLngExpression[] = [];
    displayedAtms.forEach((atm) => {
      if (!Number.isFinite(atm.lat) || !Number.isFinite(atm.lng)) return;
      boundsPoints.push([atm.lat, atm.lng]);

      const color = riskColorHex(atm.risk_level);
      const radius = Math.max(7, Math.min(16, 6 + atm.risk_score / 11));
      const isSelected = selectedAtmId === atm.atm_id;

      const marker = L.circleMarker([atm.lat, atm.lng], {
        radius: isSelected ? radius + 3 : radius,
        color: isSelected ? '#FFFFFF' : color,
        weight: isSelected ? 3 : 2,
        fillColor: color,
        fillOpacity: atm.risk_score > 0 ? 0.75 : 0.35,
      });

      marker.bindPopup(
        `<div style="font-family:sans-serif;font-size:12px;min-width:190px;">
          <strong>${atm.atm_id} · ${atm.bank}</strong><br/>
          <span>${atm.locality} — ${atm.address}</span><br/>
          <hr style="margin:6px 0;border-color:#cbd5e1;"/>
          <span>Risk Score: <strong>${atm.risk_score.toFixed(1)}/100</strong> (${atm.risk_level})</span><br/>
          <span>Window: <strong>${atm.window}</strong></span><br/>
          <span style="color:#475569;">${atm.subtitle}</span>
        </div>`
      );

      marker.on('click', () => setSelectedAtmId(atm.atm_id));
      marker.addTo(group);
    });

    if (boundsPoints.length > 0 && !selectedAtmId) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [32, 32], maxZoom: 13 });
    }
  }, [displayedAtms, clusters, withdrawals, showClusters, showWithdrawals, selectedAtmId]);

  const focusAtmOnMap = (atm: { atm_id: string; lat: number; lng: number }) => {
    setSelectedAtmId(atm.atm_id);
    mapRef.current?.flyTo([atm.lat, atm.lng], 14, { duration: 0.6 });
  };

  return (
    <CommandLayout
      title="GIS ATM Hotspot & Cash-Out Map"
      section="Intelligence Engines"
      actions={
        <button
          type="button"
          onClick={() => void loadGeoData()}
          className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh Map
        </button>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadGeoData()} /> : null}

      {/* Map Filters */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] p-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-center">
          <div className="lg:col-span-2">
            <select
              value={selectedComplaintId}
              onChange={(e) => {
                setSelectedAtmId(null);
                setSelectedComplaintId(e.target.value);
              }}
              aria-label="Filter map by complaint"
              className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
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
            onChange={(e) => setRiskFilter(e.target.value as RiskLevel | '')}
            aria-label="Filter by risk level"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
          >
            <option value="">All Risk Levels</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          <select
            value={windowFilter}
            onChange={(e) => setWindowFilter(e.target.value as PredictionWindow | '')}
            aria-label="Filter by window"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
          >
            <option value="">All Windows</option>
            <option value="0-6h">0-6h</option>
            <option value="6-12h">6-12h</option>
            <option value="12-24h">12-24h</option>
            <option value=">24h">&gt;24h</option>
          </select>

          <div className="flex items-center gap-4 text-xs text-slate-200">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showClusters}
                onChange={(e) => setShowClusters(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-[#0B1120]"
              />
              DBSCAN Clusters
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showWithdrawals}
                onChange={(e) => setShowWithdrawals(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-[#0B1120]"
              />
              Past Cash-Outs
            </label>
          </div>
        </div>
      </section>

      {/* Map + Terminal Sidebar */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-400" aria-hidden="true" />
              <span className="font-semibold text-white">OpenStreetMap Tactical Spatial Layer</span>
            </div>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {displayedAtms.length} ATMs · {clusters.length} DBSCAN clusters
            </span>
          </div>

          <div ref={mapContainerRef} className="h-[520px] w-full z-10" />

          <div className="flex flex-wrap items-center gap-4 border-t border-slate-800 px-4 py-2 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              Critical (80–100)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              High (65–79)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
              Medium (45–64)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border border-amber-400 bg-amber-500/20" />
              DBSCAN Hotspot Zone (1.8 km)
            </span>
          </div>
        </div>

        <div className="xl:col-span-4 rounded-[6px] border border-slate-800 bg-[#111827] flex flex-col overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-white">Plotted ATM Terminals</h2>
            </div>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {displayedAtms.length}
            </span>
          </div>

          <div className="divide-y divide-slate-800/80 overflow-y-auto max-h-[540px]">
            {displayedAtms.length === 0 ? (
              <EmptyDataState
                title="No ATM markers match filters"
                description="Clear risk or window filters to display all Bengaluru ATM terminals."
              />
            ) : (
              displayedAtms.map((atm) => {
                const isSelected = selectedAtmId === atm.atm_id;
                return (
                  <button
                    key={atm.atm_id}
                    type="button"
                    onClick={() => focusAtmOnMap(atm)}
                    className={`w-full px-4 py-3 text-left space-y-1.5 cursor-pointer ${
                      isSelected ? 'bg-sky-950/35' : 'hover:bg-slate-800/35'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">
                          {atm.atm_id} · {atm.bank} ({atm.locality})
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">{atm.address}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm font-bold text-white tabular-nums">
                          {atm.risk_score.toFixed(1)}/100
                        </p>
                        <StatusSignal level={atm.risk_level} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-amber-300">Window: {atm.window}</span>
                      {atm.score_source ? (
                        <ScoreSourceBadge source={atm.score_source} />
                      ) : (
                        <span className="text-slate-400">{atm.subtitle}</span>
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
