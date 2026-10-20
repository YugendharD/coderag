import { useEffect, useRef } from "react";
import * as THREE from "three";
import "./Constellation.css";

const DUST_STARS = 1800;
const NODE_COUNT = 260;          // stars in the constellation network
const LINK_DISTANCE = 6.5;       // stars closer than this are joined by a line
const MAX_LINKS_PER_NODE = 3;
const HIGHLIGHT_COUNT = 14;      // how many lines flash at the same time

// Four named constellations, drawn as stars joined by lines.
//   stars = [x, y] points, links = which stars are joined,
//   x / y / z = where the constellation sits, scale = how big it is.
// To move or resize one, change its x, y or scale.
const CONSTELLATIONS = [
  {
    // the Big Dipper
    x: -6, y: 4.2, z: -9, scale: 1.1,
    stars: [[-3.4, 0.9], [-2.0, 0.5], [-0.8, 0.2], [0.4, 0], [0.9, -1.5], [2.8, -1.6], [3.2, 0.2]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
  },
  {
    // Cassiopeia (the "W")
    x: 7, y: 4.6, z: -10, scale: 1.1,
    stars: [[-3.2, 0.6], [-1.6, -0.7], [0, 0.5], [1.7, -0.8], [3.2, 0.4]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    // Orion
    x: -10, y: -4.5, z: -9, scale: 1,
    stars: [[-1.3, 2.4], [1.3, 2.2], [-0.6, 0.2], [0, 0], [0.6, -0.2], [-1.1, -2.4], [1.2, -2.2], [0, 2.9]],
    links: [[7, 0], [7, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
  },
  {
    // Cygnus (the Northern Cross)
    x: 10, y: -4.5, z: -9, scale: 1,
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

    // the night sky turns slowly in the plane of the screen
    const sky = new THREE.Group();
    scene.add(sky);

    // ----- tiny far-away stars -----
    const dustPositions = new Float32Array(DUST_STARS * 3);
    for (let i = 0; i < DUST_STARS; i++) {
      const [x, y] = randomInDisk(55);
      dustPositions[i * 3] = x;
      dustPositions[i * 3 + 1] = y;
      dustPositions[i * 3 + 2] = random(-45, -6);
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

    // ----- the constellation network -----
    const nodes = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      const [x, y] = randomInDisk(32);
      nodes.push(new THREE.Vector3(x, y, random(-18, -4)));
    }

    // the stars are split in three groups, so they twinkle at different times
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
        size: 0.4,
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

    // thin lines that join stars that are close together
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
      color: 0xa9c4ff,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geometries.push(lineGeometry);
    materials.push(lineMaterial);
    sky.add(new THREE.LineSegments(lineGeometry, lineMaterial));

    // a few random lines flash brightly, one after another
    const segmentCount = linePositions.length / 6;
    const highlightPositions = new Float32Array(HIGHLIGHT_COUNT * 6);
    const highlightGeometry = new THREE.BufferGeometry();
    highlightGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(highlightPositions, 3)
    );
    const highlightMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geometries.push(highlightGeometry);
    materials.push(highlightMaterial);
    sky.add(new THREE.LineSegments(highlightGeometry, highlightMaterial));

    function pickHighlights() {
      if (segmentCount === 0) return;
      for (let k = 0; k < HIGHLIGHT_COUNT; k++) {
        const segment = Math.floor(Math.random() * segmentCount);
        for (let v = 0; v < 6; v++) {
          highlightPositions[k * 6 + v] = linePositions[segment * 6 + v];
        }
      }
      highlightGeometry.attributes.position.needsUpdate = true;
    }
    pickHighlights();

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
        size: 0.7,
        map: glow,
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      // the lines that join them
      const joined = [];
      setting.links.forEach(([a, b]) => {
        const [ax, ay] = setting.stars[a];
        const [bx, by] = setting.stars[b];
        joined.push(ax, ay, 0, bx, by, 0);
      });
      const joinedGeometry = new THREE.BufferGeometry();
      joinedGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(joined), 3)
      );
      const joinedMaterial = new THREE.LineBasicMaterial({
        color: 0xd7e5ff,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      geometries.push(starGeometry, joinedGeometry);
      materials.push(starMaterial, joinedMaterial);

      group.add(
        new THREE.Points(starGeometry, starMaterial),
        new THREE.LineSegments(joinedGeometry, joinedMaterial)
      );
      scene.add(group);

      return { starMaterial, joinedMaterial, phase: index * 1.3 };
    });

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
      baseZ = width / height >= 1.2 ? 14 : 18;
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
    let last = performance.now();
    let elapsed = 0;
    let energy = 0; // 0 = calm, 1 = the AI is working
    let highlightClock = 0;
    let lastCycle = 0;
    let nextShot = 2;
    let frameId = 0;

    function animate() {
      frameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += delta;

      energy += ((busyRef.current ? 1 : 0) - energy) * 0.04;

      // the sky turns slowly (faster while the AI works)
      sky.rotation.z += (0.004 + energy * 0.02) * delta;

      // stars twinkle at different times
      nodeMaterials.forEach((material, index) => {
        material.opacity = 0.8 + 0.2 * Math.sin(elapsed * 1.7 + index * 2.1);
      });
      dustMaterial.opacity = 0.75 + 0.1 * Math.sin(elapsed * 0.9);

      // the lines glow brighter while the AI works
      lineMaterial.opacity =
        0.36 + 0.2 * energy + 0.04 * Math.sin(elapsed * 0.9);

      // a few random lines flash, then fade, then new ones are picked
      highlightClock += delta * (1 + energy * 2);
      const cycle = highlightClock / 2.4;
      const cycleIndex = Math.floor(cycle);
      if (cycleIndex !== lastCycle) {
        lastCycle = cycleIndex;
        pickHighlights();
      }
      highlightMaterial.opacity =
        Math.sin(Math.PI * (cycle - cycleIndex)) * (0.55 + 0.4 * energy);

      // the named constellations shimmer
      constellations.forEach((item) => {
        item.starMaterial.opacity =
          0.85 + 0.15 * Math.sin(elapsed * 1.4 + item.phase);
        item.joinedMaterial.opacity =
          0.6 + 0.25 * energy + 0.06 * Math.sin(elapsed * 0.8 + item.phase);
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

      // the camera drifts gently with the mouse, which gives depth
      const swayX = Math.sin(elapsed * 0.3) * 0.2;
      const swayY = Math.sin(elapsed * 0.23 + 1) * 0.15;
      camera.position.x += (mouse.x * 1.3 + swayX - camera.position.x) * 0.04;
      camera.position.y += (-mouse.y * 0.8 + swayY - camera.position.y) * 0.04;
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
      highlightMaterial.opacity = 0.5;
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

  return <div className="scene" ref={mountRef} aria-hidden="true" />;
}
