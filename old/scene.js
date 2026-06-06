// ─── Scene ─────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb0e0ff);

const W = window.innerWidth, H = window.innerHeight;
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 200);
camera.position.set(0, 22, 18);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.update();


// ─── Lights ────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(12, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = sun.shadow.camera.bottom = -15;
sun.shadow.camera.right = sun.shadow.camera.top = 15;
scene.add(sun);


// ─── Ground ────────────────────────────────────────────────────────────────
const ARENA = 20;
const HALF = ARENA / 2;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA, ARENA),
  new THREE.MeshLambertMaterial({ color: 0x3a7d44 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Grid lines to help read depth
const grid = new THREE.GridHelper(ARENA, 20, 0x2a5c30, 0x2a5c30);
grid.position.y = 0.01;
scene.add(grid);


// ─── Fences ────────────────────────────────────────────────────────────────
const FENCE_H = 1.5;
const FENCE_T = 0.4;
function makeFence(x, z, w, d) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, FENCE_H, d),
    new THREE.MeshLambertMaterial({ color: 0x7a4b1e })
  );
  mesh.position.set(x, FENCE_H / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}
makeFence(0, -HALF, ARENA, FENCE_T);  // north
makeFence(0, HALF, ARENA, FENCE_T);   // south
makeFence(-HALF, 0, FENCE_T, ARENA);  // west
makeFence(HALF, 0, FENCE_T, ARENA);   // east

// Inner boundary where the player/balls can reach (fence inner face)
const INNER = HALF - FENCE_T / 2;


// ─── Blue cube (player) ─────────────────────────────────────────────────────
const PLAYER_SIZE = 1;
const PLAYER_HS = PLAYER_SIZE / 2;

const player = new THREE.Mesh(
  new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE),
  new THREE.MeshLambertMaterial({ color: 0x1155ff })
);
player.position.set(0, PLAYER_HS, 0);
player.castShadow = true;
scene.add(player);

const pv = { x: 0, z: 0 };         // player velocity
const ACCEL = 0.1;
const MAX_SPEED = 0.2;
const FRICTION = 0.80;
const BOUNCE = 0.65;              // velocity restitution on wall/cube hit


// ─── Green cubes (static obstacles) ────────────────────────────────────────
const GREEN_HS = 0.5;
const greenPositions = [
  [-4, -4], [4, -4], [-4, 4], [4, 4],
  [0, -6], [0, 6], [-6, 0], [6, 0],
  [-2, 6], [2, -6],
];
const greens = greenPositions.map(([x, z]) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0x22cc44 })
  );
  mesh.position.set(x, GREEN_HS, z);
  mesh.castShadow = true;
  scene.add(mesh);
  return mesh;
});


// ─── Red balls (dynamic) ───────────────────────────────────────────────────
const BALL_R = 0.45;
const BALL_FRICTION = 0.97;
const BALL_RESTITUTION = 0.75;
const ballPositions = [
  [-2, -2], [2, -2], [-2, 2], [2, 2],
  [0, -3], [0, 3], [-3, 0], [3, 0],
];
const balls = ballPositions.map(([x, z]) => {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 20, 20),
    new THREE.MeshLambertMaterial({ color: 0xff2222 })
  );
  mesh.position.set(x, BALL_R, z);
  mesh.castShadow = true;
  scene.add(mesh);
  return { mesh, vx: 0, vz: 0 };
});



// ─── Collision helpers ─────────────────────────────────────────────────────

// AABB vs AABB: returns {nx, nz, depth} if overlapping, else null.
// Half-extents: (ahx,ahz) for A, (bhx,bhz) for B.
function aabbCollide(ax, az, ahx, ahz, bx, bz, bhx, bhz) {
  const dx = ax - bx;
  const dz = az - bz;
  const ox = ahx + bhx - Math.abs(dx);
  const oz = ahz + bhz - Math.abs(dz);
  if (ox <= 0 || oz <= 0) return null;
  // Push along shallowest axis
  if (ox < oz) {
    return { nx: Math.sign(dx), nz: 0, depth: ox };
  } else {
    return { nx: 0, nz: Math.sign(dz), depth: oz };
  }
}

// Sphere vs AABB: returns {nx, nz, depth} if overlapping, else null.
function aabbSphere(bx, bz, bhx, bhz, sx, sz, r) {
  // Closest point on AABB to sphere center
  const cx = Math.max(bx - bhx, Math.min(sx, bx + bhx));
  const cz = Math.max(bz - bhz, Math.min(sz, bz + bhz));
  const dx = sx - cx;
  const dz = sz - cz;
  const dist2 = dx * dx + dz * dz;
  if (dist2 >= r * r) return null;
  const dist = Math.sqrt(dist2) || 0.0001;
  return { nx: dx / dist, nz: dz / dist, depth: r - dist };
}



// ─── Keyboard ──────────────────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  // prevent page scroll
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });



// ─── Physics update ─────────────────────────────────────────────────────────

function updatePlayer() {
  if (keys['ArrowLeft']) pv.x -= ACCEL;
  if (keys['ArrowRight']) pv.x += ACCEL;
  if (keys['ArrowUp']) pv.z -= ACCEL;
  if (keys['ArrowDown']) pv.z += ACCEL;

  // Speed cap
  const spd = Math.sqrt(pv.x * pv.x + pv.z * pv.z);
  if (spd > MAX_SPEED) {
    pv.x = pv.x / spd * MAX_SPEED;
    pv.z = pv.z / spd * MAX_SPEED;
  }

  player.position.x += pv.x;
  player.position.z += pv.z;

  // Friction when not pressing keys
  if (!keys['ArrowLeft'] && !keys['ArrowRight']) pv.x *= FRICTION;
  if (!keys['ArrowUp'] && !keys['ArrowDown']) pv.z *= FRICTION;

  // Tiny-velocity limit
  if (Math.abs(pv.x) < 0.001) pv.x = 0;
  if (Math.abs(pv.z) < 0.001) pv.z = 0;

  playerVsGreens();
  playerVsBalls();
  playerVsFences();
}

function playerVsFences() {
  const limit = INNER - PLAYER_HS;
  const p = player.position;
  if (p.x < -limit) { p.x = -limit; pv.x = Math.abs(pv.x) * BOUNCE; }
  if (p.x > limit) { p.x = limit; pv.x = -Math.abs(pv.x) * BOUNCE; }
  if (p.z < -limit) { p.z = -limit; pv.z = Math.abs(pv.z) * BOUNCE; }
  if (p.z > limit) { p.z = limit; pv.z = -Math.abs(pv.z) * BOUNCE; }
}

function playerVsGreens() {
  const p = player.position;
  for (const g of greens) {
    const col = aabbCollide(
      p.x, p.z, PLAYER_HS, PLAYER_HS,
      g.position.x, g.position.z, GREEN_HS, GREEN_HS
    );
    if (!col) continue;
    // Push player out
    p.x += col.nx * col.depth;
    p.z += col.nz * col.depth;
    // Reflect velocity on collision axis
    if (col.nx !== 0) pv.x = col.nx * Math.abs(pv.x) * BOUNCE;
    if (col.nz !== 0) pv.z = col.nz * Math.abs(pv.z) * BOUNCE;
  }
}

function playerVsBalls() {
  const p = player.position;
  for (const ball of balls) {
    const b = ball.mesh.position;
    const col = aabbSphere(p.x, p.z, PLAYER_HS, PLAYER_HS, b.x, b.z, BALL_R);
    if (!col) continue;
    // Relative velocity along collision normal
    const relVn = (pv.x - ball.vx) * col.nx + (pv.z - ball.vz) * col.nz;
    if (relVn < 0) continue; // already separating

    // Simple impulse
    const impulse = relVn * 1.2; // mass ratio ≈ 1:1
    ball.vx += col.nx * impulse * 0.9;
    ball.vz += col.nz * impulse * 0.9;
    pv.x -= col.nx * impulse * 0.4;
    pv.z -= col.nz * impulse * 0.4;

    // Positional correction
    b.x += col.nx * col.depth * 0.6;
    b.z += col.nz * col.depth * 0.6;
    p.x -= col.nx * col.depth * 0.4;
    p.z -= col.nz * col.depth * 0.4;
  }
}

function updateBalls() {
  for (const ball of balls) {
    ball.mesh.position.x += ball.vx;
    ball.mesh.position.z += ball.vz;
    ball.vx *= BALL_FRICTION;
    ball.vz *= BALL_FRICTION;
    if (Math.abs(ball.vx) < 0.0005) ball.vx = 0;
    if (Math.abs(ball.vz) < 0.0005) ball.vz = 0;

    ballVsFences(ball);
    ballVsGreens(ball);
  }

  // Resolve ball-to-ball collisions once per pair
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      ballVsBall(balls[i], balls[j]);
    }
  }
}

function ballVsFences(ball) {
  const b = ball.mesh.position;
  const limit = INNER - BALL_R;
  if (b.x < -limit) { b.x = -limit; ball.vx = Math.abs(ball.vx) * BALL_RESTITUTION; }
  if (b.x > limit) { b.x = limit; ball.vx = -Math.abs(ball.vx) * BALL_RESTITUTION; }
  if (b.z < -limit) { b.z = -limit; ball.vz = Math.abs(ball.vz) * BALL_RESTITUTION; }
  if (b.z > limit) { b.z = limit; ball.vz = -Math.abs(ball.vz) * BALL_RESTITUTION; }
}

function ballVsGreens(ball) {
  const b = ball.mesh.position;
  for (const g of greens) {
    const col = aabbSphere(g.position.x, g.position.z, GREEN_HS, GREEN_HS, b.x, b.z, BALL_R);
    if (!col) continue;
    b.x += col.nx * col.depth;
    b.z += col.nz * col.depth;
    const vn = ball.vx * col.nx + ball.vz * col.nz;
    if (vn > 0) continue;
    ball.vx -= 2 * vn * col.nx * BALL_RESTITUTION;
    ball.vz -= 2 * vn * col.nz * BALL_RESTITUTION;
  }
}

function ballVsBall(ballA, ballB) {
  const a = ballA.mesh.position;
  const b = ballB.mesh.position;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const minDist = BALL_R * 2;
  if (dist >= minDist || dist < 0.0001) return;

  const nx = dx / dist;
  const nz = dz / dist;

  // Relative velocity along the normal (B -> A)
  // rvn < 0 means they are moving towards each other
  const rvn = (ballA.vx - ballB.vx) * nx + (ballA.vz - ballB.vz) * nz;
  if (rvn > 0) return; // already separating

  // Equal mass elastic collision
  const impulse = rvn * BALL_RESTITUTION;
  ballA.vx -= impulse * nx;
  ballA.vz -= impulse * nz;
  ballB.vx += impulse * nx;
  ballB.vz += impulse * nz;

  // Positional correction to prevent sticking
  const overlap = minDist - dist;
  a.x += nx * overlap * 0.5;
  a.z += nz * overlap * 0.5;
  b.x -= nx * overlap * 0.5;
  b.z -= nz * overlap * 0.5;
}



// ─── Render loop ───────────────────────────────────────────────────────────
function animate() {
  updatePlayer();
  updateBalls();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// ─── Resize ────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
