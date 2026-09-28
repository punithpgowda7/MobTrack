'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface CyberBackground3DProps {
  isStreaming?: boolean;
}

export default function CyberBackground3D({ isStreaming = false }: CyberBackground3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Detect low-power or mobile devices
    const isMobile = window.innerWidth < 768;
    const particleCount = isMobile ? 32 : 64;
    const maxConnectionDistance = isMobile ? 120 : 160;

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      1000,
    );
    camera.position.z = 400;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: 'low-power',
        precision: 'mediump',
      });
    } catch {
      // WebGL not supported or disabled - gracefully degrade without error
      return;
    }

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    container.appendChild(canvas);

    // Particle nodes
    const positions = new Float32Array(particleCount * 3);
    const velocities: { x: number; y: number; z: number }[] = [];
    const spreadX = window.innerWidth * 0.8;
    const spreadY = window.innerHeight * 0.8;

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spreadX;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spreadY;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 150;

      velocities.push({
        x: (Math.random() - 0.5) * 0.35,
        y: (Math.random() - 0.5) * 0.35,
        z: (Math.random() - 0.5) * 0.15,
      });
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );

    const particleMaterial = new THREE.PointsMaterial({
      color: 0x10b981,
      size: isMobile ? 3 : 4,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // Dynamic interconnecting tactical lines
    const maxLines = (particleCount * (particleCount - 1)) / 2;
    const linePositions = new Float32Array(maxLines * 6);
    const lineColors = new Float32Array(maxLines * 6);

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(linePositions, 3),
    );
    lineGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(lineColors, 3),
    );

    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.45,
    });

    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);

    // Smooth subtle mouse parallax
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      targetX = (e.clientX - window.innerWidth / 2) * 0.05;
      targetY = (e.clientY - window.innerHeight / 2) * 0.05;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // Handle resize
    const handleResize = () => {
      if (!renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    // Visibility change handler for low power
    let isPaused = false;
    const handleVisibilityChange = () => {
      isPaused = document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    let animationFrameId = 0;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // CRITICAL ZERO-LATENCY RULE:
      // If live streaming camera video or tab is hidden, skip 100% of WebGL calculations!
      if (isStreamingRef.current || isPaused || !renderer) {
        return;
      }

      // Parallax lerp
      mouseX += (targetX - mouseX) * 0.05;
      mouseY += (targetY - mouseY) * 0.05;
      camera.position.x = mouseX;
      camera.position.y = -mouseY;
      camera.lookAt(scene.position);

      // Update particles
      const posAttr = particleGeometry.attributes.position as THREE.BufferAttribute;
      const posArray = posAttr.array as Float32Array;

      const halfW = window.innerWidth * 0.45;
      const halfH = window.innerHeight * 0.45;

      for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        posArray[i3] += velocities[i].x;
        posArray[i3 + 1] += velocities[i].y;
        posArray[i3 + 2] += velocities[i].z;

        // Soft bounce boundaries
        if (posArray[i3] < -halfW || posArray[i3] > halfW) velocities[i].x *= -1;
        if (posArray[i3 + 1] < -halfH || posArray[i3 + 1] > halfH) velocities[i].y *= -1;
        if (posArray[i3 + 2] < -100 || posArray[i3 + 2] > 100) velocities[i].z *= -1;
      }
      posAttr.needsUpdate = true;

      // Update connection lines
      let lineIndex = 0;
      let colorIndex = 0;
      const lPos = lineGeometry.attributes.position.array as Float32Array;
      const lCol = lineGeometry.attributes.color.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        const xi = posArray[i3];
        const yi = posArray[i3 + 1];
        const zi = posArray[i3 + 2];

        for (let j = i + 1; j < particleCount; j++) {
          const j3 = j * 3;
          const xj = posArray[j3];
          const yj = posArray[j3 + 1];
          const zj = posArray[j3 + 2];

          const dx = xi - xj;
          const dy = yi - yj;
          const dz = zi - zj;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < maxConnectionDistance) {
            const alpha = 1.0 - dist / maxConnectionDistance;

            lPos[lineIndex++] = xi;
            lPos[lineIndex++] = yi;
            lPos[lineIndex++] = zi;

            lPos[lineIndex++] = xj;
            lPos[lineIndex++] = yj;
            lPos[lineIndex++] = zj;

            // Tactical Emerald (r: 0.06, g: 0.72, b: 0.50)
            const lr = 0.06 * alpha;
            const lg = 0.72 * alpha;
            const lb = 0.50 * alpha;

            lCol[colorIndex++] = lr;
            lCol[colorIndex++] = lg;
            lCol[colorIndex++] = lb;

            lCol[colorIndex++] = lr;
            lCol[colorIndex++] = lg;
            lCol[colorIndex++] = lb;
          }
        }
      }

      lineGeometry.setDrawRange(0, lineIndex / 3);
      lineGeometry.attributes.position.needsUpdate = true;
      lineGeometry.attributes.color.needsUpdate = true;

      renderer.render(scene, camera);
    };

    animate();

    // Clean up on unmount
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (renderer) {
        if (canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
        renderer.dispose();
      }

      particleGeometry.dispose();
      particleMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-40 overflow-hidden"
    />
  );
}
