'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function HoloGlobe3D() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 280;
    const height = mount.clientHeight || 220;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 7.5);

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: 'low-power',
      });
    } catch {
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    mount.appendChild(canvas);

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // Low-poly wireframe globe
    const globeGeo = new THREE.SphereGeometry(2.0, 16, 12);
    const globeWire = new THREE.WireframeGeometry(globeGeo);
    const globeMat = new THREE.LineBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.35,
    });
    const sphere = new THREE.LineSegments(globeWire, globeMat);
    globeGroup.add(sphere);

    // Latitude & Longitude emphasis rings
    const ringGeo1 = new THREE.RingGeometry(2.4, 2.45, 32);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const ring1 = new THREE.Mesh(ringGeo1, ringMat1);
    ring1.rotation.x = Math.PI / 2.5;
    globeGroup.add(ring1);

    const ringGeo2 = new THREE.RingGeometry(2.7, 2.74, 32);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x059669,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
    ring2.rotation.x = -Math.PI / 3;
    globeGroup.add(ring2);

    // Pulsing satellite beacon point
    const satGeo = new THREE.BufferGeometry();
    satGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const satMat = new THREE.PointsMaterial({
      color: 0xf43f5e,
      size: 6,
      transparent: true,
      opacity: 0.9,
    });
    const satPoint = new THREE.Points(satGeo, satMat);
    globeGroup.add(satPoint);

    let animId = 0;
    let angle = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (document.hidden || !renderer) return;

      globeGroup.rotation.y += 0.005;
      ring1.rotation.z += 0.008;
      ring2.rotation.z -= 0.006;

      // Orbiting satellite
      angle += 0.02;
      const orbitR = 2.42;
      satPoint.position.x = Math.cos(angle) * orbitR;
      satPoint.position.y = Math.sin(angle) * Math.sin(Math.PI / 2.5) * orbitR;
      satPoint.position.z = Math.sin(angle) * Math.cos(Math.PI / 2.5) * orbitR;

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!mount || !renderer) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);

      if (renderer) {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        renderer.dispose();
      }

      globeGeo.dispose();
      globeWire.dispose();
      globeMat.dispose();
      ringGeo1.dispose();
      ringMat1.dispose();
      ringGeo2.dispose();
      ringMat2.dispose();
      satGeo.dispose();
      satMat.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="w-full h-full min-h-[220px] flex items-center justify-center pointer-events-none relative"
    />
  );
}
