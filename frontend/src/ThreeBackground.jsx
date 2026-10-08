import { useEffect, useRef } from "react";
import * as THREE from "three";

const PARTICLE_COUNT = 1500;

// draws a soft round glow that we use for every particle
function makeGlowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.55)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

export default function ThreeBackground({ busy }) {
  const mountRef = useRef(null);
  const busyRef = useRef(false);

  // remember whether the AI is busy, so the animation can speed up
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      // this device cannot draw 3D: the website still works without it
      return undefined;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 9);

    // ----- floating particles -----
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const blue = new THREE.Color(0x4f8cff);
    const purple = new THREE.Color(0xb57bff);
    const color = new THREE.Color();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const radius = 4 + Math.random() * 9;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      // flatten the depth so no particle gets too close to the camera
      positions[i * 3 + 2] = radius * Math.cos(phi) * 0.4;

      color.copy(blue).lerp(purple, Math.random());
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const glowTexture = makeGlowTexture();
    const particleMaterial = new THREE.PointsMaterial({
      size: 0.16,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // ----- spinning 3D shapes -----
    const shapes = new THREE.Group();

    const outerGeometry = new THREE.IcosahedronGeometry(2.2, 1);
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: 0x6aa5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.4,
    });
    const outer = new THREE.Mesh(outerGeometry, outerMaterial);

    const innerGeometry = new THREE.OctahedronGeometry(1.2, 0);
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: 0xb57bff,
      wireframe: true,
      transparent: true,
      opacity: 0.7,
    });
    const inner = new THREE.Mesh(innerGeometry, innerMaterial);

    const ringGeometry = new THREE.TorusGeometry(3.3, 0.02, 8, 120);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff7bd5,
      transparent: true,
      opacity: 0.55,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2.4;

    shapes.add(outer, inner, ring);
    scene.add(shapes);

    // ----- size and position (wide screens: shapes on the right) -----
    function layout() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      const wide = width / height > 1.3;
      shapes.position.x = wide ? 6 : 0;
      shapes.scale.setScalar(wide ? 1 : 0.7);
    }
    layout();

    // ----- mouse -----
    const mouse = { x: 0, y: 0 };
    function onMouseMove(event) {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (event.clientY / window.innerHeight) * 2 - 1;
    }

    // ----- animation -----
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const clock = new THREE.Clock();
    let elapsed = 0;
    let speed = 1;
    let frameId = 0;

    function animate() {
      frameId = requestAnimationFrame(animate);

      const delta = Math.min(clock.getDelta(), 0.05);
      elapsed += delta;
      speed += ((busyRef.current ? 4 : 1) - speed) * 0.05;

      outer.rotation.x += 0.15 * delta * speed;
      outer.rotation.y += 0.2 * delta * speed;
      inner.rotation.x -= 0.3 * delta * speed;
      inner.rotation.y -= 0.25 * delta * speed;
      ring.rotation.z += 0.2 * delta * speed;
      particles.rotation.y += 0.02 * delta * speed;
      shapes.position.y = Math.sin(elapsed * 0.8) * 0.3;

      camera.position.x += (mouse.x * 1.5 - camera.position.x) * 0.03;
      camera.position.y += (-mouse.y * 1.0 - camera.position.y) * 0.03;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    }

    function handleResize() {
      layout();
      if (reduceMotion) renderer.render(scene, camera);
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", onMouseMove);

    if (reduceMotion) {
      // people who prefer less motion get a still picture
      renderer.render(scene, camera);
    } else {
      animate();
    }

    // ----- clean up when the page closes -----
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", onMouseMove);

      particleGeometry.dispose();
      particleMaterial.dispose();
      glowTexture.dispose();
      outerGeometry.dispose();
      outerMaterial.dispose();
      innerGeometry.dispose();
      innerMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div className="scene" ref={mountRef} aria-hidden="true" />;
}