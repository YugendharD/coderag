import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import "./Constellation.css";

const GALAXY_STARS = 9000;
const GALAXY_RADIUS = 11;
const ARMS = 4;
const DUST_STARS = 1400;
const NODE_COUNT = 240;          // stars in the random constellation network
const LINK_DISTANCE = 6.5;
const MAX_LINKS_PER_NODE = 3;
const MOTE_COUNT = 90;           // floating dust motes close to the camera

// soft colored clouds behind the galaxy
const NEBULAS = [
  { color: 0xff5fd0, x: -14, y: 6, z: -12, size: 26, opacity: 0.22 },
  { color: 0x4f8cff, x: 15, y: -6, z: -14, size: 30, opacity: 0.24 },
  { color: 0xa855ff, x: 2, y: 10, z: -18, size: 32, opacity: 0.2 },
  { color: 0x22d3ee, x: -10, y: -10, z: -16, size: 26, opacity: 0.16 },
  { color: 0xffa05a, x: 18, y: 9, z: -10, size: 20, opacity: 0.14 },
];

// Four named constellations, drawn as stars joined by lines.
//   stars = [x, y] points, links = which stars are joined,
//   x / y / z = where the constellation sits, scale = how big it is.
// To move or resize one, change its x, y or scale.
const CONSTELLATIONS = [
  {
    // the Big Dipper
    x: -3.5, y: 9, z: -9, scale: 1,
    stars: [[-3.4, 0.9], [-2.0, 0.5], [-0.8, 0.2], [0.4, 0], [0.9, -1.5], [2.8, -1.6], [3.2, 0.2]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
  },
  {
    // Cassiopeia (the "W")
    x: 9, y: 9.2, z: -10, scale: 1,
    stars: [[-3.2, 0.6], [-1.6, -0.7], [0, 0.5], [1.7, -0.8], [3.2, 0.4]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    // Orion
    x: -11, y: -2, z: -9, scale: 0.95,
    stars: [[-1.3, 2.4], [1.3, 2.2], [-0.6, 0.2], [0, 0], [0.6, -0.2], [-1.1, -2.4], [1.2, -2.2], [0, 2.9]],
    links: [[7, 0], [7, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
  },
  {
    // Cygnus (the Northern Cross)
    x: 10.5, y: -2, z: -9, scale: 0.95,
    stars: [[0, 3], [0, 0.2], [0, -2.8], [-2.3, 0.5], [2.3, -0.1]],
    links: [[0, 1], [1, 2], [3, 1], [1, 4]],
  },
];

function random(min, max) {
  return min + Math.random() * (max - min);
}

// a random point inside a circle (so the sky looks the same as it turns)
function randomInDisk(radius) {
  const angle = Math.random() * Math.PI * 2;
  const distance = radius * Math.sqrt(Math.random());
  return [Math.cos(angle) * distance, Math.sin(angle) * distance];
}

// draws a soft round glow that we use for every star
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

  // the opening title sequence (skipped for people who prefer less motion)
  const [intro, setIntro] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (!intro) return undefined;
    const timer = setTimeout(() => setIntro(false), 5200);
    return () => clearTimeout(timer);
  }, [intro]);

  // remember whether the AI is busy, so the sky can brighten
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
    const glow = makeGlowTexture();

    // ----- the spiral galaxy -----
    const galaxyPositions = new Float32Array(GALAXY_STARS * 3);
    const galaxyColors = new Float32Array(GALAXY_STARS * 3);
    const core = new THREE.Color(0xffd9a8);
    const middle = new THREE.Color(0xd08cff);
    const edge = new THREE.Color(0x6aa8ff);
    const color = new THREE.Color();

    for (let i = 0; i < GALAXY_STARS; i++) {
      const radius = Math.pow(Math.random(), 1.6) * GALAXY_RADIUS;
      const branchAngle = ((i % ARMS) / ARMS) * Math.PI * 2;
      const spinAngle = radius * 0.45;
      const scatter = radius * 0.28 + 0.2;

      const sideX = Math.random() < 0.5 ? 1 : -1;
      const sideY = Math.random() < 0.5 ? 1 : -1;
      const sideZ = Math.random() < 0.5 ? 1 : -1;
      const offsetX = Math.pow(Math.random(), 3) * sideX * scatter;
      const offsetY = Math.pow(Math.random(), 3) * sideY * scatter * 0.5;
      const offsetZ = Math.pow(Math.random(), 3) * sideZ * scatter;

      galaxyPositions[i * 3] =
        Math.cos(branchAngle + spinAngle) * radius + offsetX;
      galaxyPositions[i * 3 + 1] = offsetY;
      galaxyPositions[i * 3 + 2] =
        Math.sin(branchAngle + spinAngle) * radius + offsetZ;

      const t = radius / GALAXY_RADIUS;
      if (t < 0.4) {
        color.copy(core).lerp(middle, t / 0.4);
      } else {
        color.copy(middle).lerp(edge, (t - 0.4) / 0.6);
      }
      galaxyColors[i * 3] = color.r;
      galaxyColors[i * 3 + 1] = color.g;
      galaxyColors[i * 3 + 2] = color.b;
    }

    const galaxyGeometry = new THREE.BufferGeometry();
    galaxyGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(galaxyPositions, 3)
    );
    galaxyGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(galaxyColors, 3)
    );
    const galaxyMaterial = new THREE.PointsMaterial({
      size: 0.105,
      map: glow,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    geometries.push(galaxyGeometry);
    materials.push(galaxyMaterial);

    const galaxy = new THREE.Group();
    galaxy.add(new THREE.Points(galaxyGeometry, galaxyMaterial));

    // a bright glow in the middle of the galaxy
    const coreMaterial = new THREE.SpriteMaterial({
      map: glow,
      color: 0xffc080,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    materials.push(coreMaterial);
    const coreGlow = new THREE.Sprite(coreMaterial);
    coreGlow.scale.set(9, 9, 1);
    galaxy.add(coreGlow);

    const galaxyTilt = new THREE.Group();
    galaxyTilt.rotation.set(0.12, 0, 0.28);
    galaxyTilt.add(galaxy);
    scene.add(galaxyTilt);

    // ----- the named constellations (they stay in place) -----
    const constellations = CONSTELLATIONS.map((setting, index) => {
      const group = new THREE.Group();
      group.position.set(setting.x, setting.y, setting.z);
      group.scale.setScalar(setting.scale);

      // the stars
      const starPositions = new Float32Array(setting.stars.length * 3);
      setting.stars.forEach(([x, y], starIndex) => {
        starPositions[starIndex * 3] = x;
        starPositions[starIndex * 3 + 1] = y;
        starPositions[starIndex * 3 + 2] = 0;
      });
      const starGeometry = new THREE.BufferGeometry();
      starGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(starPositions, 3)
      );
      const starMaterial = new THREE.PointsMaterial({
        size: 0.6,
        map: glow,
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      // the lines that join them
      const linkPositions = [];
      setting.links.forEach(([a, b]) => {
        const [ax, ay] = setting.stars[a];
        const [bx, by] = setting.stars[b];
        linkPositions.push(ax, ay, 0, bx, by, 0);
      });
      const linkGeometry = new THREE.BufferGeometry();
      linkGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(linkPositions), 3)
      );
      const linkMaterial = new THREE.LineBasicMaterial({
        color: 0xbfd4ff,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      geometries.push(starGeometry, linkGeometry);
      materials.push(starMaterial, linkMaterial);

      group.add(
        new THREE.Points(starGeometry, starMaterial),
        new THREE.LineSegments(linkGeometry, linkMaterial)
      );
      scene.add(group);

      return { starMaterial, linkMaterial, phase: index * 1.3 };
    });

    // ----- the sky: colored clouds, dust and the constellation network -----
    // (it turns slowly, like a real night sky)
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
      const [x, y] = randomInDisk(52);
      dustPositions[i * 3] = x;
      dustPositions[i * 3 + 1] = y;
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

    // network stars (split in three groups, so they twinkle at different times)
    const nodes = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      const [x, y] = randomInDisk(30);
      nodes.push(new THREE.Vector3(x, y, random(-16, -6)));
    }

    const nodeMaterials = [0, 1, 2].map((layer) => {
      const mine = nodes.filter((_, index) => index % 3 === layer);
      const positions = new Float32Array(mine.length * 3);
      mine.forEach((point, index) => {
        positions[index * 3] = point.x;
        positions[index * 3 + 1] = point.y;
        positions[index * 3 + 2] = point.z;
      });

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.36,
        map: glow,
        color: 0xeaf1ff,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      geometries.push(geometry);
      materials.push(material);
      sky.add(new THREE.Points(geometry, material));
      return material;
    });

    // thin lines that join network stars that are close together
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

    // ----- floating dust motes, close to the camera (like in a film) -----
    const motePositions = new Float32Array(MOTE_COUNT * 3);
    const moteSpeeds = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i++) {
      motePositions[i * 3] = random(-16, 16);
      motePositions[i * 3 + 1] = random(-9, 9);
      motePositions[i * 3 + 2] = random(2, 8);
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
    let baseZ = 13;
    function layout() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      baseZ = width / height >= 1.2 ? 13 : 17;
    }
    layout();

    // the opening shot starts far away and flies in toward the galaxy
    camera.position.set(
      0,
      6.5 + (reduceMotion ? 0 : 2.5),
      baseZ + (reduceMotion ? 0 : 16)
    );
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
    let nextShot = 2;
    let frameId = 0;

    function animate() {
      frameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += delta;

      energy += ((busyRef.current ? 1 : 0) - energy) * 0.04;

      // the galaxy turns slowly, and faster while the AI works
      galaxy.rotation.y += (0.035 + energy * 0.35) * delta;
      coreMaterial.opacity = 0.75 + 0.2 * energy;

      // the night sky turns slowly in the plane of the screen
      sky.rotation.z += (0.004 + energy * 0.02) * delta;

      // network stars twinkle at different times, lines glow while working
      nodeMaterials.forEach((material, index) => {
        material.opacity = 0.8 + 0.2 * Math.sin(elapsed * 1.7 + index * 2.1);
      });
      lineMaterial.opacity =
        0.32 + 0.18 * energy + 0.05 * Math.sin(elapsed * 0.9);

      // the named constellations shimmer and glow brighter while working
      constellations.forEach((item) => {
        item.starMaterial.opacity =
          0.85 + 0.15 * Math.sin(elapsed * 1.4 + item.phase);
        item.linkMaterial.opacity =
          0.5 + 0.25 * energy + 0.06 * Math.sin(elapsed * 0.8 + item.phase);
      });

      nebulas.forEach((nebula, index) => {
        nebula.material.opacity =
          nebula.base *
          (1 + 0.5 * energy) *
          (0.9 + 0.1 * Math.sin(elapsed * 0.6 + index));
      });

      // dust motes drift slowly upward
      for (let i = 0; i < MOTE_COUNT; i++) {
        motePositions[i * 3 + 1] += moteSpeeds[i] * delta;
        motePositions[i * 3] += Math.sin(elapsed * 0.4 + i) * 0.15 * delta;
        if (motePositions[i * 3 + 1] > 9) motePositions[i * 3 + 1] = -9;
      }
      moteGeometry.attributes.position.needsUpdate = true;

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

      camera.position.x += (mouse.x * 1.4 + swayX - camera.position.x) * 0.03;
      camera.position.y +=
        (6.5 - mouse.y * 0.9 + swayY + rise - camera.position.y) * 0.03;
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
      glow.dispose();
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