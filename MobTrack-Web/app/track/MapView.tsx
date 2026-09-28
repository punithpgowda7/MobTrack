'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export type PathPoint = { latitude: number; longitude: number; timestamp: number };
export const PATH_GAP_BREAK_MS = 30 * 60 * 1000;
export const orderPathHistory = (points: PathPoint[]) => points.slice().sort((a, b) => a.timestamp - b.timestamp);
export const splitPathSegments = (points: PathPoint[]) => {
  const segments: PathPoint[][] = [];
  points.forEach((point, index) => {
    if (index === 0 || point.timestamp - points[index - 1].timestamp > PATH_GAP_BREAK_MS) segments.push([point]);
    else segments[segments.length - 1].push(point);
  });
  return segments;
};

interface MapViewProps {
  latitude: number;
  longitude: number;
  history?: PathPoint[];
  /** Enables Feature 2-only history markers and route rendering. */
  historyMode?: boolean;
  onPointClick?: (point: PathPoint) => void;
}

/** Existing Leaflet/OpenStreetMap map, extended with a chronological path. */
export default function MapView({ latitude, longitude, history = [], historyMode = false, onPointClick }: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const currentMarkerRef = useRef<import('leaflet').Marker | null>(null);

  useEffect(() => {
    let isMounted = true;
    let resizeObserver: ResizeObserver | null = null;

    const initMap = async () => {
      const L = (await import('leaflet')).default;
      if (!mapContainerRef.current || !isMounted) return;
      if (!mapInstanceRef.current) {
        const map = L.map(mapContainerRef.current, { center: [latitude, longitude], zoom: 17, zoomControl: true, attributionControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
        }).addTo(map);
        mapInstanceRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);

        if (mapContainerRef.current) {
          resizeObserver = new ResizeObserver(() => {
            map.invalidateSize();
          });
          resizeObserver.observe(mapContainerRef.current);
        }
      }
      const map = mapInstanceRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;

      // Invalidate size in case container layout completed after mount
      map.invalidateSize();

      // Live Location deliberately remains the original current-location-only
      // view. It never receives Feature 2 history numbering or a route.
      if (!historyMode) {
        layer.clearLayers();

        const redPinSvg = `
          <svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 6px rgba(0,0,0,0.45));display:block;">
            <path d="M17 0C7.611 0 0 7.611 0 17C0 28.5 17 44 17 44C17 44 34 28.5 34 17C34 7.611 26.389 0 17 0Z" fill="#EF4444" stroke="#FFFFFF" stroke-width="2.5" stroke-linejoin="round"/>
            <circle cx="17" cy="16" r="6" fill="#FFFFFF"/>
          </svg>`;

        const redIcon = L.divIcon({
          html: redPinSvg,
          className: '',
          iconSize: [34, 44],
          iconAnchor: [17, 44], // Bottom needle point exactly on coordinate
          popupAnchor: [0, -44], // Top center of pin, directly above needle
        });

        const popupContent = `<b>📍 Phone Location</b><br>${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

        if (!currentMarkerRef.current) {
          currentMarkerRef.current = L.marker([latitude, longitude], { icon: redIcon }).addTo(map)
            .bindPopup(popupContent, {
              closeButton: false,
              autoClose: false,
              closeOnClick: false,
              offset: [0, -4],
            })
            .openPopup();
        } else {
          currentMarkerRef.current.setIcon(redIcon);
          currentMarkerRef.current.setLatLng([latitude, longitude]);
          currentMarkerRef.current.setPopupContent(popupContent);
          if (!currentMarkerRef.current.isPopupOpen()) {
            currentMarkerRef.current.openPopup();
          }
        }
        map.setView([latitude, longitude], map.getZoom());
        return;
      }

      currentMarkerRef.current?.remove();
      currentMarkerRef.current = null;
      layer.clearLayers();
      // Number and draw from timestamp order, never database insertion order.
      const points = orderPathHistory(history.length ? history : [{ latitude, longitude, timestamp: Date.now() }]);
      const coords = points.map((p) => [p.latitude, p.longitude] as [number, number]);
      splitPathSegments(points).forEach((segment) => {
        if (segment.length > 1) L.polyline(segment.map((p) => [p.latitude, p.longitude] as [number, number]), { color: '#38bdf8', weight: 5, opacity: 0.9, lineJoin: 'round' }).addTo(layer);
      });
      const latest = points[points.length - 1];
      points.forEach((point, index) => {
        const isLatest = point === latest;
        const pointNumber = index + 1;
        const size = isLatest ? 26 : 22;
        const icon = L.divIcon({
          className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${isLatest ? '#facc15' : '#38bdf8'};color:#0f172a;font-weight:800;font-size:12px;border:3px solid #0f172a;box-shadow:0 0 0 2px ${isLatest ? '#facc15' : '#38bdf8'}">${pointNumber}</div>`,
        });
        const marker = L.marker([point.latitude, point.longitude], { icon }).addTo(layer);
        marker.bindPopup(`<b>Spot ${pointNumber}${isLatest ? ' · ★ Latest place' : ''}</b><br>${new Date(point.timestamp).toLocaleString()}<br>${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`);
        marker.on('click', () => onPointClick?.(point));
      });
      if (coords.length > 1 && history.length > 1) map.fitBounds(L.latLngBounds(coords), { padding: [24, 24] });
      else map.setView([latitude, longitude], map.getZoom());
    };
    initMap().catch(console.error);
    return () => {
      isMounted = false;
      resizeObserver?.disconnect();
    };
  }, [latitude, longitude, history, historyMode, onPointClick]);

  useEffect(() => () => {
    mapInstanceRef.current?.remove(); mapInstanceRef.current = null; layerRef.current = null; currentMarkerRef.current = null;
  }, []);

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '100%' }} />;
}
