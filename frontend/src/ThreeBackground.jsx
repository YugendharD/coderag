import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import "./Eclipse.css";

const MOON_RADIUS = 3.4;
const CORONA_RADIUS = 9;
const DUST_STARS = 900;
const NODE_COUNT = 110;
const LINK_DISTANCE = 6.5;
const MAX_LINKS_PER_NODE = 3;
const MOTE_COUNT = 90;      // floating dust motes close to the camera
const TRAIL_LENGTH = 70;    // how long the rocket's glowing trail is

// The planets. To change them, edit this list:
//   radius = size, rx / ry / rz = how wide the orbit is,
//   speed = how fast it travels, start = where it begins on its orbit,
//   spin = how fast it turns, halo = colour of its soft glow
const PLANETS = [
  { kind: "rock", radius: 0.32, rx: 8.4, ry: 2.9, rz: 3.5, speed: 0.5, start: 0.5, spin: 0.8, halo: 0xb9b2a8 },
  { kind: "venus", radius: 0.55, rx: 9.8, ry: 3.3, rz: 4.1, speed: 0.38, start: 2.2, spin: 0.35, halo: 0xffd9a0 },
  { kind: "earth", radius: 0.72, rx: 11.2, ry: 3.8, rz: 4.7, speed: 0.3, start: 3.6, spin: 0.6, halo: 0x6fb0ff, moon: true },
  { kind: "gas", radius: 1.1, rx: 12.6, ry: 4.3, rz: 5.3, speed: 0.22, start: 5.2, spin: 0.4, halo: 0xffd9a8, rings: true },
  { kind: "mars", radius: 0.46, rx: 14.0, ry: 4.8, rz: 5.9, speed: 0.17, start: 1.2, spin: 0.55, halo: 0xff8a6a },
];

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

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
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

// paints the surface of a planet (craters, clouds, oceans, stripes ...)
function makePlanetTexture(kind) {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  // a soft round spot of colour (drawn three times so the picture wraps around)
  function blob(x, y, r, rgb, alpha, hard = false) {
    for (const dx of [-w, 0, w]) {
      const gradient = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`);
      gradient.addColorStop(
        hard ? 0.7 : 0.4,
        `rgba(${rgb}, ${hard ? alpha : alpha * 0.5})`
      );
      gradient.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  }

  function fill(color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }

  if (kind === "rock") {
    fill("#8d8780");
    for (let i = 0; i < 140; i++) {
      blob(
        random(0, w),
        random(0, h),
        random(6, 34),
        pick(["70, 66, 62", "170, 164, 154"]),
        random(0.12, 0.3)
      );
    }
    for (let i = 0; i < 45; i++) {
      const r = random(4, 16);
      ctx.beginPath();
      ctx.arc(random(0, w), random(0, h), r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(60, 56, 52, 0.35)";
      ctx.fill();
      ctx.strokeStyle = "rgba(200, 195, 185, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  } else if (kind === "venus") {
    fill("#e3c389");
    const palette = ["240, 215, 160", "214, 170, 110", "250, 235, 200"];
    for (let i = 0; i < 34; i++) {
      ctx.fillStyle = `rgba(${pick(palette)}, ${random(0.2, 0.4)})`;
      ctx.fillRect(0, random(0, h), w, random(6, 22));
    }
    for (let i = 0; i < 60; i++) {
      blob(random(0, w), random(0, h), random(10, 36), "255, 245, 220", 0.18);
    }
  } else if (kind === "earth") {
    fill("#1c58b8");
    for (let i = 0; i < 50; i++) {
      blob(
        random(0, w),
        random(0, h),
        random(20, 50),
        pick(["30, 100, 200", "10, 60, 150"]),
        0.25
      );
    }
    for (let i = 0; i < 16; i++) {
      const cx = random(0, w);
      const cy = random(40, h - 40);
      for (let j = 0; j < 7; j++) {
        blob(
          cx + random(-30, 30),
          cy + random(-18, 18),
          random(14, 34),
          pick(["58, 148, 72", "96, 160, 80", "150, 125, 70"]),
          0.95,
          true
        );
      }
    }
    ctx.fillStyle = "rgba(240, 248, 255, 0.92)";
    ctx.fillRect(0, 0, w, 12);
    ctx.fillRect(0, h - 12, w, 12);
    for (let i = 0; i < 55; i++) {
      blob(
        random(0, w),
        random(0, h),
        random(10, 34),
        "255, 255, 255",
        random(0.25, 0.45)
      );
    }
  } else if (kind === "mars") {
    fill("#b4552f");
    for (let i = 0; i < 60; i++) {
      blob(random(0, w), random(0, h), random(20, 50), "120, 50, 30", 0.3);
    }
    for (let i = 0; i < 50; i++) {
      blob(random(0, w), random(0, h), random(15, 40), "222, 150, 100", 0.25);
    }
    ctx.fillStyle = "rgba(245, 245, 250, 0.85)";
    ctx.fillRect(0, 0, w, 8);
    ctx.fillRect(0, h - 8, w, 8);
  } else {
    // "gas": a planet made of coloured stripes, with a storm
    fill("#d9b98a");
    const palette = [
      "226, 190, 140",
      "196, 150, 100",
      "240, 215, 175",
      "168, 120, 80",
      "210, 170, 120",
    ];
    let y = 0;
    while (y < h) {
      const thickness = random(6, 20);
      ctx.fillStyle = `rgba(${pick(palette)}, ${random(0.55, 0.95)})`;
      ctx.fillRect(0, y, w, thickness);
      y += thickness;
    }
    blob(w * 0.3, h * 0.62, 26, "170, 80, 50", 0.6, true);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// paints the rings of the ringed planet (stripes with a gap)
function makeRingTexture(innerFraction) {
  const size = 512;
  const half = size / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(
    half,
    half,
    half * innerFraction,
    half,
    half,
    half
  );
  gradient.addColorStop(0.0, "rgba(205, 180, 145, 0)");
  gradient.addColorStop(0.06, "rgba(215, 190, 155, 0.7)");
  gradient.addColorStop(0.22, "rgba(235, 215, 180, 0.4)");
  gradient.addColorStop(0.32, "rgba(225, 200, 165, 0.85)");
  gradient.addColorStop(0.52, "rgba(205, 180, 145, 0.55)");
  gradient.addColorStop(0.58, "rgba(205, 180, 145, 0.08)");
  gradient.addColorStop(0.66, "rgba(230, 208, 172, 0.8)");
  gradient.addColorStop(0.88, "rgba(215, 190, 155, 0.55)");
  gradient.addColorStop(1.0, "rgba(205, 180, 145, 0)");

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(half, half, half, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function ThreeBackground({ busy }) {
  const mountRef = useRef(null);
  const busyRef = useRef(false);

  // the opening title sequence (skipped for people who prefer less motion)
  const [intro, setIntro] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (!intro) return undefined;
    const timer = setTimeout(() => setIntro(false), 5200);
    return () => clearTimeout(timer);
  }, [intro]);

  // remember whether the AI is busy, so everything can speed up
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

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

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

    // lights, so the planets and the rocket look round
    scene.add(new THREE.AmbientLight(0xb8c4ff, 2.2));
    const sunlight = new THREE.DirectionalLight(0xfff2e0, 3.4);
    sunlight.position.set(-8, 10, 14);
    scene.add(sunlight);

    // ----- the eclipse -----
    const eclipse = new THREE.Group();
    scene.add(eclipse);

    function addGlow(color, scale, opacity, z, scaleY = scale) {
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
      sprite.scale.set(scale, scaleY, 1);
      sprite.position.z = z;
      eclipse.add(sprite);
      return material;
    }

    // glowing halos behind the moon
    const haloWide = addGlow(0x8d7bff, 26, 0.3, -1.5);
    const haloWarm = addGlow(0xffb27a, 14, 0.55, -1.0);
    const haloBright = addGlow(0xfff0d8, 9, 0.8, -0.8);

    // cinematic lens streaks: long horizontal lines of light
    const streakBlue = addGlow(0xaed0ff, 36, 0.6, -0.9, 0.55);
    const streakSoft = addGlow(0x8d7bff, 52, 0.18, -0.95, 1.6);

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

    // ----- the planets -----
    const orbitMaterials = [];

    function addOrbitLine(rx, ry, rz) {
      const points = [];
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        points.push(Math.cos(a) * rx, -Math.sin(a) * ry, Math.sin(a) * rz);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(points), 3)
      );
      const material = new THREE.LineBasicMaterial({
        color: 0x9bbcff,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      geometries.push(geometry);
      materials.push(material);
      orbitMaterials.push(material);
      scene.add(new THREE.LineLoop(geometry, material));
    }

    const planets = PLANETS.map((config) => {
      addOrbitLine(config.rx, config.ry, config.rz);

      const group = new THREE.Group();
      scene.add(group);

      // the round body of the planet
      const geometry = new THREE.SphereGeometry(config.radius, 48, 32);
      const texture = makePlanetTexture(config.kind);
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 1,
        metalness: 0,
      });
      geometries.push(geometry);
      materials.push(material);
      textures.push(texture);

      const body = new THREE.Mesh(geometry, material);
      group.add(body);

      // a faint glow around it, like an atmosphere
      const haloMaterial = new THREE.SpriteMaterial({
        map: glow,
        color: config.halo,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      materials.push(haloMaterial);
      const halo = new THREE.Sprite(haloMaterial);
      halo.scale.set(config.radius * 3.4, config.radius * 3.4, 1);
      group.add(halo);

      // rings (for the big striped planet)
      if (config.rings) {
        const inner = config.radius * 1.45;
        const outer = config.radius * 2.5;
        const ringsGeometry = new THREE.RingGeometry(inner, outer, 96);
        const ringsTexture = makeRingTexture(inner / outer);
        const ringsMaterial = new THREE.MeshBasicMaterial({
          map: ringsTexture,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        geometries.push(ringsGeometry);
        materials.push(ringsMaterial);
        textures.push(ringsTexture);

        const rings = new THREE.Mesh(ringsGeometry, ringsMaterial);
        rings.rotation.set(-Math.PI / 2 + 0.5, 0, 0.35);
        group.add(rings);
      }

      // a tiny moon that circles the planet (for Earth)
      let moonPivot = null;
      if (config.moon) {
        moonPivot = new THREE.Group();
        moonPivot.rotation.x = 0.3;
        group.add(moonPivot);

        const satelliteGeometry = new THREE.SphereGeometry(
          config.radius * 0.26,
          24,
          16
        );
        const satelliteMaterial = new THREE.MeshStandardMaterial({
          color: 0xb9b6ae,
          roughness: 1,
          metalness: 0,
        });
        geometries.push(satelliteGeometry);
        materials.push(satelliteMaterial);

        const satellite = new THREE.Mesh(satelliteGeometry, satelliteMaterial);
        satellite.position.x = config.radius * 1.9;
        moonPivot.add(satellite);
      }

      return { config, group, body, moonPivot, angle: config.start };
    });

    // puts a planet at its place on its orbit
    function placePlanet(planet) {
      const { rx, ry, rz } = planet.config;
      const a = planet.angle;
      planet.group.position.set(
        Math.cos(a) * rx,
        -Math.sin(a) * ry,
        Math.sin(a) * rz
      );
    }
    planets.forEach(placePlanet);

    // ----- the little rocket that flies by now and then -----
    const rocket = new THREE.Group();
    rocket.visible = false;
    scene.add(rocket);

    const rocketWhite = new THREE.MeshStandardMaterial({
      color: 0xf4f6ff,
      roughness: 0.45,
      metalness: 0.2,
    });
    const rocketRed = new THREE.MeshStandardMaterial({
      color: 0xff4d5e,
      roughness: 0.5,
      metalness: 0.1,
    });
    const rocketDark = new THREE.MeshStandardMaterial({
      color: 0x3a4157,
      roughness: 0.6,
      metalness: 0.4,
    });
    const rocketGlass = new THREE.MeshStandardMaterial({
      color: 0x6ed0ff,
      emissive: 0x2f9fe0,
      emissiveIntensity: 1.2,
      roughness: 0.2,
    });
    materials.push(rocketWhite, rocketRed, rocketDark, rocketGlass);

    const bodyGeometry = new THREE.CylinderGeometry(0.11, 0.13, 0.62, 20);
    const noseGeometry = new THREE.ConeGeometry(0.11, 0.3, 20);
    const finGeometry = new THREE.BoxGeometry(0.03, 0.24, 0.2);
    const windowGeometry = new THREE.SphereGeometry(0.05, 16, 12);
    const nozzleGeometry = new THREE.CylinderGeometry(0.07, 0.09, 0.08, 16);
    geometries.push(
      bodyGeometry,
      noseGeometry,
      finGeometry,
      windowGeometry,
      nozzleGeometry
    );

    const rocketBody = new THREE.Mesh(bodyGeometry, rocketWhite);
    const rocketNose = new THREE.Mesh(noseGeometry, rocketRed);
    rocketNose.position.y = 0.46;
    const rocketNozzle = new THREE.Mesh(nozzleGeometry, rocketDark);
    rocketNozzle.position.y = -0.35;
    const rocketWindow = new THREE.Mesh(windowGeometry, rocketGlass);
    rocketWindow.position.set(0, 0.12, 0.11);
    rocket.add(rocketBody, rocketNose, rocketNozzle, rocketWindow);

    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const fin = new THREE.Mesh(finGeometry, rocketRed);
      fin.position.set(Math.sin(angle) * 0.15, -0.22, Math.cos(angle) * 0.15);
      fin.rotation.y = angle;
      rocket.add(fin);
    }

    // the glowing flame at the back of the rocket
    function addFlame(color, scale, y) {
      const material = new THREE.SpriteMaterial({
        map: glow,
        color,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      materials.push(material);
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(scale, scale, 1);
      sprite.position.y = y;
      rocket.add(sprite);
      return { sprite, scale };
    }
    const flameOuter = addFlame(0xffa04d, 0.8, -0.55);
    const flameCore = addFlame(0xfff1c9, 0.4, -0.45);

    // the glowing trail the rocket leaves behind it
    const trailPositions = new Float32Array(TRAIL_LENGTH * 3);
    const trailColors = new Float32Array(TRAIL_LENGTH * 3);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(trailPositions, 3)
    );
    trailGeometry.setAttribute("color", new THREE.BufferAttribute(trailColors, 3));
    trailGeometry.setDrawRange(0, 0);
    const trailMaterial = new THREE.PointsMaterial({
      size: 0.22,
      map: glow,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geometries.push(trailGeometry);
    materials.push(trailMaterial);
    const trailPoints = new THREE.Points(trailGeometry, trailMaterial);
    trailPoints.frustumCulled = false;
    scene.add(trailPoints);

    const trail = [];
    const trailWarm = new THREE.Color(0xffa04d);
    const trailCool = new THREE.Color(0x8d7bff);
    const trailColor = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let flight = null; // the rocket's current trip: { curve, t, duration }

    function launchRocket() {
      const side = Math.random() < 0.5 ? 1 : -1;
      const y0 = random(-5, 4);
      const points = [
        new THREE.Vector3(-22 * side, y0 + random(-2, 3), random(-10, -4)),
        new THREE.Vector3(-9 * side, y0 + random(-3, 3), random(-2, 3)),
        new THREE.Vector3(3 * side, y0 + random(-3, 3), random(4, 8)),
        new THREE.Vector3(12 * side, y0 + random(-3, 3), random(2, 7)),
        new THREE.Vector3(24 * side, y0 + random(-2, 4), random(-6, 0)),
      ];
      flight = {
        curve: new THREE.CatmullRomCurve3(points),
        t: 0,
        duration: random(8, 11),
      };
      rocket.visible = true;
    }

    // ----- floating dust motes, close to the camera (like in a film) -----
    const motePositions = new Float32Array(MOTE_COUNT * 3);
    const moteSpeeds = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i++) {
      motePositions[i * 3] = random(-16, 16);
      motePositions[i * 3 + 1] = random(-9, 9);
      motePositions[i * 3 + 2] = random(3, 10);
      moteSpeeds[i] = random(0.05, 0.25);
    }
    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(motePositions, 3)
    );
    const moteMaterial = new THREE.PointsMaterial({
      size: 0.55,
      map: glow,
      color: 0xffe2b0,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geometries.push(moteGeometry);
    materials.push(moteMaterial);
    scene.add(new THREE.Points(moteGeometry, moteMaterial));

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

    // the opening shot starts far away and flies in toward the eclipse
    camera.position.set(0, reduceMotion ? 0 : 2.5, baseZ + (reduceMotion ? 0 : 16));
    camera.lookAt(0, 0, 0);

    // ----- mouse -----
    const mouse = { x: 0, y: 0 };
    function onMouseMove(event) {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (event.clientY / window.innerHeight) * 2 - 1;
    }

    // ----- animation -----
    let last = performance.now();
    let elapsed = 0;
    let energy = 0; // 0 = calm, 1 = the AI is working
    let flareAngle = 0.8;
    let nextShot = 2;
    let nextRocket = 8; // seconds until the first rocket flies by
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

      // glows and lens streaks
      haloBright.opacity = 0.75 + 0.2 * energy;
      haloWarm.opacity = 0.5 + 0.2 * energy;
      haloWide.opacity = 0.28 + 0.12 * energy;
      streakBlue.opacity = 0.5 + 0.2 * energy + 0.1 * Math.sin(elapsed * 1.1);
      streakSoft.opacity = 0.16 + 0.08 * energy;
      ringMaterial.opacity = 0.8 + 0.2 * Math.sin(elapsed * 1.3);

      // the eclipse floats very gently
      eclipse.position.y = Math.sin(elapsed * 0.5) * 0.15;

      // the planets travel around the eclipse and turn on their axes
      planets.forEach((planet) => {
        planet.angle += planet.config.speed * delta * (1 + energy * 2);
        placePlanet(planet);
        planet.body.rotation.y += planet.config.spin * delta;
        if (planet.moonPivot) {
          planet.moonPivot.rotation.y += 1.4 * delta;
        }
      });
      orbitMaterials.forEach((material) => {
        material.opacity = 0.14 + 0.1 * energy;
      });

      // the rocket
      nextRocket -= delta;
      if (nextRocket <= 0 && !flight) {
        launchRocket();
        nextRocket = random(18, 28);
      }

      if (flight) {
        flight.t += delta / flight.duration;
        if (flight.t >= 1) {
          flight = null;
          rocket.visible = false;
        } else {
          const position = flight.curve.getPoint(flight.t);
          const tangent = flight.curve.getTangent(flight.t);
          rocket.position.copy(position);
          rocket.quaternion.setFromUnitVectors(up, tangent);
          rocket.rotateY(elapsed * 2); // a slow roll while it flies

          const flicker = 1 + 0.18 * Math.sin(elapsed * 40);
          flameOuter.sprite.scale.setScalar(flameOuter.scale * flicker);
          flameCore.sprite.scale.setScalar(flameCore.scale * flicker);

          trail.unshift(position.clone().addScaledVector(tangent, -0.65));
          if (trail.length > TRAIL_LENGTH) trail.pop();
        }
      } else if (trail.length > 0) {
        trail.pop(); // the trail slowly fades away after the rocket has gone
      }

      for (let i = 0; i < trail.length; i++) {
        trailPositions[i * 3] = trail[i].x;
        trailPositions[i * 3 + 1] = trail[i].y;
        trailPositions[i * 3 + 2] = trail[i].z;

        const fade = 1 - i / TRAIL_LENGTH;
        trailColor.copy(trailWarm).lerp(trailCool, i / TRAIL_LENGTH);
        trailColors[i * 3] = trailColor.r * Math.pow(fade, 1.5);
        trailColors[i * 3 + 1] = trailColor.g * Math.pow(fade, 1.5);
        trailColors[i * 3 + 2] = trailColor.b * Math.pow(fade, 1.5);
      }
      trailGeometry.setDrawRange(0, trail.length);
      trailGeometry.attributes.position.needsUpdate = true;
      trailGeometry.attributes.color.needsUpdate = true;

      // dust motes drift slowly upward
      for (let i = 0; i < MOTE_COUNT; i++) {
        motePositions[i * 3 + 1] += moteSpeeds[i] * delta;
        motePositions[i * 3] += Math.sin(elapsed * 0.4 + i) * 0.15 * delta;
        if (motePositions[i * 3 + 1] > 9) motePositions[i * 3 + 1] = -9;
      }
      moteGeometry.attributes.position.needsUpdate = true;

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

      // the camera: opening fly-in, then a gentle hand-held sway and mouse drift
      const progress = Math.min(elapsed / 5.5, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const dolly = (1 - eased) * 16;
      const rise = (1 - eased) * 2.5;
      const swayX = Math.sin(elapsed * 0.35) * 0.25;
      const swayY = Math.sin(elapsed * 0.27 + 1) * 0.18;

      camera.position.x += (mouse.x * 0.9 + swayX - camera.position.x) * 0.03;
      camera.position.y += (-mouse.y * 0.6 + swayY + rise - camera.position.y) * 0.03;
      camera.position.z += (baseZ + dolly - camera.position.z) * 0.05;
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

  return (
    <>
      <div className="scene" ref={mountRef} aria-hidden="true" />

      {/* the movie look: light leaks, dark corners and film grain */}
      <div className="film-leak" aria-hidden="true" />
      <div className="film-vignette" aria-hidden="true" />
      <div className="film-grain" aria-hidden="true" />

      {/* the opening title sequence */}
      {intro && (
        <div className="intro" onClick={() => setIntro(false)} role="presentation">
          <div className="intro-bar top" />
          <div className="intro-bar bottom" />
          <div className="intro-title">
            <p className="intro-kicker">A GITHUB REPOSITORY STORY</p>
            <h2>CodeRAG</h2>
            <p className="intro-sub">Ask any codebase anything</p>
          </div>
          <p className="intro-skip">Click anywhere to skip</p>
        </div>
      )}
    </>
  );
}