import { useEffect, useRef } from "react";
import * as THREE from "three";
import "./Eclipse.css";

const MOON_RADIUS = 3.4;
const CORONA_RADIUS = 9;
const DUST_STARS = 900;
const NODE_COUNT = 110;
const LINK_DISTANCE = 6.5;
const MAX_LINKS_PER_NODE = 3;

// soft colored clouds far behind the eclipse
const NEBULAS = [
  { color: 0xff5fd0, x: -14, y: 6, z: -12, size: 26, opacity: 0.2 },
  { color: 0x4f8cff, x: 15, y: -6, z: -14, size: 30, opacity: 0.22 },
  { color: 0xa855ff, x: 2, y: 10, z: -18, size: 32, opacity: 0.18 },
  { color: 0x22d3ee, x: -10, y: -10, z: -16, size: 26, opacity: 0.14 },
];

function random(min, max) {
  return min + Math.random() * (max - min);
}

// draws a soft round glow that we use for stars and halos
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

// draws the corona: a soft glow plus many long streamers of light
function makeCoronaTexture(rayCount) {
  const size = 512;
  const half = size / 2;
  const inner = (MOON_RADIUS / CORONA_RADIUS) * half; // the moon's edge

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  context.translate(half, half);
  context.globalCompositeOperation = "lighter";

  // soft glow right around the moon
  const base = context.createRadialGradient(0, 0, inner * 0.9, 0, 0, half);
  base.addColorStop(0, "rgba(255, 238, 215, 0.85)");
  base.addColorStop(0.18, "rgba(255, 190, 150, 0.4)");
  base.addColorStop(0.6, "rgba(190, 140, 255, 0.12)");
  base.addColorStop(1, "rgba(120, 140, 255, 0)");
  context.fillStyle = base;
  context.beginPath();
  context.arc(0, 0, half, 0, Math.PI * 2);
  context.fill();

  // long streamers of light
  for (let i = 0; i < rayCount; i++) {
    context.save();
    context.rotate(Math.random() * Math.PI * 2);

    const start = inner * 0.92;
    const length = (half - start) * (0.25 + Math.pow(Math.random(), 1.4) * 0.75);
    const width = 2 + Math.random() * 7;
    const tint = Math.random() < 0.25 ? "170, 200, 255" : "255, 238, 220";

    const gradient = context.createLinearGradient(start, 0, start + length, 0);
    gradient.addColorStop(0, `rgba(${tint}, 0.55)`);
    gradient.addColorStop(1, `rgba(${tint}, 0)`);
    context.fillStyle = gradient;

    context.beginPath();
    context.moveTo(start, -width / 2);
    context.lineTo(start + length, 0);
    context.lineTo(start, width / 2);
    context.closePath();
    context.fill();

    context.restore();
  }

  return new THREE.CanvasTexture(canvas);
}

export default function ThreeBackground({ busy }) {
  const mountRef = useRef(null);
  const busyRef = useRef(false);

  // remember whether the AI is busy, so the eclipse can speed up
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
      200
    );

    // everything we create is remembered here, so we can clean up later
    const geometries = [];
    const materials = [];
    const textures = [];

    const glow = makeGlowTexture();
    const coronaTextureA = makeCoronaTexture(110);
    const coronaTextureB = makeCoronaTexture(80);
    textures.push(glow, coronaTextureA, coronaTextureB);

    // ----- the eclipse -----
    const eclipse = new THREE.Group();
    scene.add(eclipse);

    function addGlow(color, scale, opacity, z) {
      const material = new THREE.SpriteMaterial({
        map: glow,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      materials.push(material);

      const sprite = new THREE.Sprite(material);
      sprite.scale.set(scale, scale, 1);
      sprite.position.z = z;
      eclipse.add(sprite);
      return material;
    }

    // glowing halos behind the moon
    const haloWide = addGlow(0x8d7bff, 26, 0.3, -1.5);
    const haloWarm = addGlow(0xffb27a, 14, 0.55, -1.0);
    const haloBright = addGlow(0xfff0d8, 9, 0.8, -0.8);

    // two layers of streamers that turn in opposite directions
    const coronaGeometry = new THREE.PlaneGeometry(
      CORONA_RADIUS * 2,
      CORONA_RADIUS * 2
    );
    geometries.push(coronaGeometry);

    function addCorona(texture, opacity, z) {
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      materials.push(material);

      const mesh = new THREE.Mesh(coronaGeometry, material);
      mesh.position.z = z;
      eclipse.add(mesh);
      return mesh;
    }

    const coronaA = addCorona(coronaTextureA, 0.95, -0.5);
    const coronaB = addCorona(coronaTextureB, 0.7, -0.6);

    // the thin reddish ring right at the edge of the moon
    const ringGeometry = new THREE.RingGeometry(
      MOON_RADIUS * 0.995,
      MOON_RADIUS * 1.05,
      160
    );
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8a5c,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    geometries.push(ringGeometry);
    materials.push(ringMaterial);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.z = -0.02;
    eclipse.add(ring);

    // the moon: a solid black disc that hides the sun
    const moonGeometry = new THREE.CircleGeometry(MOON_RADIUS, 128);
    const moonMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    geometries.push(moonGeometry);
    materials.push(moonMaterial);
    eclipse.add(new THREE.Mesh(moonGeometry, moonMaterial));

    // the "diamond ring": a bright flare that travels around the moon's edge
    function addFlare(color, scale, opacity) {
      const material = new THREE.SpriteMaterial({
        map: glow,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      materials.push(material);

      const sprite = new THREE.Sprite(material);
      sprite.scale.set(scale, scale, 1);
      eclipse.add(sprite);
      return { sprite, material };
    }

    const flare = addFlare(0xfff1c9, 3.6, 0.9);
    const bead = addFlare(0xffffff, 1.1, 1);

    // ----- the sky: colored clouds, dust and constellations -----
    const sky = new THREE.Group();

    const nebulas = NEBULAS.map((setting) => {
      const material = new THREE.SpriteMaterial({
        map: glow,
        color: setting.color,
        transparent: true,
        opacity: setting.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      materials.push(material);

      const sprite = new THREE.Sprite(material);
      sprite.position.set(setting.x, setting.y, setting.z);
      sprite.scale.set(setting.size, setting.size, 1);
      sky.add(sprite);

      return { material, base: setting.opacity };
    });

    const dustPositions = new Float32Array(DUST_STARS * 3);
    for (let i = 0; i < DUST_STARS; i++) {
      dustPositions[i * 3] = random(-45, 45);
      dustPositions[i * 3 + 1] = random(-25, 25);
      dustPositions[i * 3 + 2] = random(-40, -4);
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(dustPositions, 3)
    );
    const dustMaterial = new THREE.PointsMaterial({
      size: 0.13,
      map: glow,
      color: 0xdfeaff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geometries.push(dustGeometry);
    materials.push(dustMaterial);
    sky.add(new THREE.Points(dustGeometry, dustMaterial));

    // constellation stars (the bright dots) ...
    const nodes = [];
    const nodePositions = new Float32Array(NODE_COUNT * 3);
    for (let i = 0; i < NODE_COUNT; i++) {
      const point = new THREE.Vector3(
        random(-24, 24),
        random(-13, 13),
        random(-16, -2)
      );
      nodes.push(point);
      nodePositions[i * 3] = point.x;
      nodePositions[i * 3 + 1] = point.y;
      nodePositions[i * 3 + 2] = point.z;
    }
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(nodePositions, 3)
    );
    const nodeMaterial = new THREE.PointsMaterial({
      size: 0.36,
      map: glow,
      color: 0xeaf1ff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geometries.push(nodeGeometry);
    materials.push(nodeMaterial);
    sky.add(new THREE.Points(nodeGeometry, nodeMaterial));

    // ... and the thin lines that connect stars that are close together
    const linkCounts = new Array(NODE_COUNT).fill(0);
    const linePositions = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      for (let j = i + 1; j < NODE_COUNT; j++) {
        if (
          linkCounts[i] >= MAX_LINKS_PER_NODE ||
          linkCounts[j] >= MAX_LINKS_PER_NODE
        ) {
          continue;
        }
        if (nodes[i].distanceTo(nodes[j]) < LINK_DISTANCE) {
          linePositions.push(
            nodes[i].x, nodes[i].y, nodes[i].z,
            nodes[j].x, nodes[j].y, nodes[j].z
          );
          linkCounts[i] += 1;
          linkCounts[j] += 1;
        }
      }
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(linePositions), 3)
    );
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x9bbcff,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geometries.push(lineGeometry);
    materials.push(lineMaterial);
    sky.add(new THREE.LineSegments(lineGeometry, lineMaterial));

    scene.add(sky);

    // ----- shooting stars -----
    const shooters = [];
    for (let i = 0; i < 3; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(6), 3)
      );
      // bright head, dark tail: with glowing blending the tail fades away
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array([1, 1, 1, 0, 0, 0]), 3)
      );
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geometry, material);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);

      geometries.push(geometry);
      materials.push(material);
      shooters.push({
        line,
        geometry,
        material,
        head: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
      });
    }

    function launchShootingStar() {
      const shooter = shooters.find((item) => item.life <= 0);
      if (!shooter) return;
      shooter.head.set(random(-16, -2), random(4, 9), random(-8, -3));
      shooter.velocity.set(random(16, 24), random(-10, -6), 0);
      shooter.life = 1.1;
      shooter.line.visible = true;
    }

    // ----- size and camera position -----
    let baseZ = 14;
    function layout() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      baseZ = width / height >= 1.2 ? 14 : 19;
    }
    layout();
    camera.position.set(0, 0, baseZ);
    camera.lookAt(0, 0, 0);

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
    let last = performance.now();
    let elapsed = 0;
    let energy = 0; // 0 = calm, 1 = the AI is working
    let flareAngle = 0.8;
    let nextShot = 2;
    let frameId = 0;

    function placeFlare() {
      const x = Math.cos(flareAngle) * MOON_RADIUS;
      const y = Math.sin(flareAngle) * MOON_RADIUS;
      flare.sprite.position.set(x, y, 0.05);
      bead.sprite.position.set(x, y, 0.06);
    }
    placeFlare();

    function animate() {
      frameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += delta;

      energy += ((busyRef.current ? 1 : 0) - energy) * 0.04;

      // the streamers turn in opposite directions (faster while the AI works)
      coronaA.rotation.z += (0.07 + energy * 0.35) * delta;
      coronaB.rotation.z -= (0.045 + energy * 0.25) * delta;

      // the corona slowly "breathes"
      coronaA.scale.setScalar(1 + 0.03 * Math.sin(elapsed * 0.8));
      coronaB.scale.setScalar(1.12 * (1 + 0.03 * Math.sin(elapsed * 0.65 + 1)));

      // the diamond ring flare travels around the moon's edge
      flareAngle += (0.5 + energy * 1.5) * delta;
      placeFlare();
      flare.material.opacity = 0.75 + 0.25 * Math.sin(elapsed * 3);

      // glows
      haloBright.opacity = 0.75 + 0.2 * energy;
      haloWarm.opacity = 0.5 + 0.2 * energy;
      haloWide.opacity = 0.28 + 0.12 * energy;
      ringMaterial.opacity = 0.8 + 0.2 * Math.sin(elapsed * 1.3);

      // the eclipse floats very gently
      eclipse.position.y = Math.sin(elapsed * 0.5) * 0.15;

      // the sky turns slowly, stars twinkle, lines glow while working
      sky.rotation.y += (0.004 + energy * 0.02) * delta;
      nodeMaterial.opacity = 0.85 + 0.15 * Math.sin(elapsed * 1.7);
      lineMaterial.opacity =
        0.3 + 0.18 * energy + 0.05 * Math.sin(elapsed * 0.9);
      nebulas.forEach((nebula, index) => {
        nebula.material.opacity =
          nebula.base *
          (1 + 0.5 * energy) *
          (0.9 + 0.1 * Math.sin(elapsed * 0.6 + index));
      });

      // shooting stars
      nextShot -= delta;
      if (nextShot <= 0) {
        launchShootingStar();
        nextShot = random(3, 7);
      }
      shooters.forEach((shooter) => {
        if (shooter.life <= 0) return;

        shooter.head.addScaledVector(shooter.velocity, delta);
        const tail = shooter.head.clone().addScaledVector(shooter.velocity, -0.1);
        const positions = shooter.geometry.attributes.position.array;
        positions[0] = shooter.head.x;
        positions[1] = shooter.head.y;
        positions[2] = shooter.head.z;
        positions[3] = tail.x;
        positions[4] = tail.y;
        positions[5] = tail.z;
        shooter.geometry.attributes.position.needsUpdate = true;

        shooter.life -= delta;
        shooter.material.opacity = Math.max(0, Math.min(1, shooter.life / 0.4));
        if (shooter.life <= 0) shooter.line.visible = false;
      });

      // the camera drifts a little with the mouse, which gives depth
      camera.position.x += (mouse.x * 0.9 - camera.position.x) * 0.03;
      camera.position.y += (-mouse.y * 0.6 - camera.position.y) * 0.03;
      camera.position.z += (baseZ - camera.position.z) * 0.05;
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

      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      textures.forEach((item) => item.dispose());
      renderer.dispose();

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div className="scene" ref={mountRef} aria-hidden="true" />;
}