'use client';

import { useEffect, useRef } from 'react';

interface MapViewProps {
  latitude: number;
  longitude: number;
  history?: Array<{ latitude: number; longitude: number; timestamp: number }>;
}

/**
 * OpenStreetMap map using Leaflet.js.
 * No API key required — free and open source.
 * Dynamically imported (SSR: false) because Leaflet requires browser APIs.
 */
export default function MapView({ latitude, longitude, history = [] }: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<import('leaflet').Map | null>(null);
  const markerRef = useRef<import('leaflet').Marker | null>(null);
  const routeRef = useRef<import('leaflet').Polyline | null>(null);

  useEffect(() => {
    // Leaflet is imported here (not at module top level) to avoid SSR issues
    let isMounted = true;

    const initMap = async () => {
      const L = (await import('leaflet')).default;

      // Fix default icon paths (webpack bundles them differently)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (!mapContainerRef.current || !isMounted) return;

      // Inject Leaflet CSS dynamically (avoids Next.js SSR issues)
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      // Create map if it doesn't exist yet
      if (!mapInstanceRef.current) {
        const map = L.map(mapContainerRef.current, {
          center: [latitude, longitude],
          zoom: 17,
          zoomControl: true,
          attributionControl: true,
        });

        // OpenStreetMap tile layer — completely free, no API key
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(map);

        // Red custom marker for the device location
        const redIcon = L.divIcon({
          html: `<div style="
            width: 28px;
            height: 36px;
            background: #ef4444;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 3px solid #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5);
            position: relative;
          ">
            <div style="
              width: 10px;
              height: 10px;
              background: #fff;
              border-radius: 50%;
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
            "></div>
          </div>`,
          className: '',
          iconSize: [28, 36],
          iconAnchor: [14, 36],
          popupAnchor: [0, -36],
        });

        const marker = L.marker([latitude, longitude], { icon: redIcon })
          .addTo(map)
          .bindPopup(`<b>📍 Device Location</b><br>${latitude.toFixed(6)}, ${longitude.toFixed(6)}`, {
            closeButton: false,
          })
          .openPopup();

        mapInstanceRef.current = map;
        markerRef.current = marker;
        if (history.length > 1) {
          routeRef.current = L.polyline(history.map((p) => [p.latitude, p.longitude] as [number, number]), { color: '#38bdf8', weight: 4 }).addTo(map);
          map.fitBounds(routeRef.current.getBounds().pad(0.15));
        }
      } else {
        // Map already exists — just update position
        mapInstanceRef.current.setView([latitude, longitude], mapInstanceRef.current.getZoom());
        markerRef.current?.setLatLng([latitude, longitude]);
        if (routeRef.current) routeRef.current.setLatLngs(history.map((p) => [p.latitude, p.longitude] as [number, number]));
        else if (history.length > 1) routeRef.current = L.polyline(history.map((p) => [p.latitude, p.longitude] as [number, number]), { color: '#38bdf8', weight: 4 }).addTo(mapInstanceRef.current);
      }
    };

    initMap().catch(console.error);

    return () => {
      isMounted = false;
    };
  }, [latitude, longitude, history]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
        routeRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={mapContainerRef}
      style={{ width: '100%', height: '100%', minHeight: '350px' }}
    />
  );
}
