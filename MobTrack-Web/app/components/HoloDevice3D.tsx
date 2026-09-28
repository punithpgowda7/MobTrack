'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function HoloDevice3D() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 240;
    const height = mount.clientHeight || 180;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 8.5);

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

    // Group for the entire device
    const deviceGroup = new THREE.Group();
    scene.add(deviceGroup);

    // Outer phone chassis (wireframe box)
    const chassisGeo = new THREE.BoxGeometry(2.4, 4.8, 0.25);
    const edges = new THREE.EdgesGeometry(chassisGeo);
    const chassisMat = new THREE.LineBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.85,
    });
    const wireChassis = new THREE.LineSegments(edges, chassisMat);
    deviceGroup.add(wireChassis);

    // Inner screen display frame
    const screenGeo = new THREE.PlaneGeometry(2.1, 4.3);
    const screenMat = new THREE.MeshBasicMaterial({
      color: 0x064e3b,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.z = 0.05;
    deviceGroup.add(screenMesh);

    // Camera notch
    const notchGeo = new THREE.RingGeometry(0.04, 0.08, 16);
    const notchMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
    });
    const notch = new THREE.Mesh(notchGeo, notchMat);
    notch.position.set(0, 2.05, 0.13);
    deviceGroup.add(notch);

    // Laser scanline plane
    const scanlineGeo = new THREE.PlaneGeometry(2.2, 0.05);
    const scanlineMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const scanline = new THREE.Mesh(scanlineGeo, scanlineMat);
    scanline.position.z = 0.14;
    deviceGroup.add(scanline);

    // Tactical HUD crosshairs in the center
    const crossHairGeo = new THREE.BufferGeometry();
    const crossPoints = new Float32Array([
      -0.3, 0, 0.14, 0.3, 0, 0.14,
      0, -0.3, 0.14, 0, 0.3, 0.14,
    ]);
    crossHairGeo.setAttribute('position', new THREE.BufferAttribute(crossPoints, 3));
    const crossHairMat = new THREE.LineBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.6,
    });
    const crossHairs = new THREE.LineSegments(crossHairGeo, crossHairMat);
    deviceGroup.add(crossHairs);

    // Initial slight rotation
    deviceGroup.rotation.y = 0.2;
    deviceGroup.rotation.x = 0.1;

    let scanY = 2.0;
    let scanDirection = -1;
    let animId = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (document.hidden || !renderer) return;

      // Gentle floating yaw
      deviceGroup.rotation.y = Math.sin(Date.now() * 0.0012) * 0.25;
      deviceGroup.rotation.x = Math.cos(Date.now() * 0.001) * 0.08;

      // Scanline sweep
      scanY += scanDirection * 0.035;
      if (scanY < -2.0) {
        scanY = -2.0;
        scanDirection = 1;
      } else if (scanY > 2.0) {
        scanY = 2.0;
        scanDirection = -1;
      }
      scanline.position.y = scanY;

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

      chassisGeo.dispose();
      edges.dispose();
      chassisMat.dispose();
      screenGeo.dispose();
      screenMat.dispose();
      notchGeo.dispose();
      notchMat.dispose();
      scanlineGeo.dispose();
      scanlineMat.dispose();
      crossHairGeo.dispose();
      crossHairMat.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="w-full h-full min-h-[160px] flex items-center justify-center pointer-events-none relative"
    />
  );
}
