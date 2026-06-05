// Rapier-backed version of scene.js — swap script in scene.html: scene.js → rapier.js
(async () => {
  const RAPIER = (await import(
    'https://esm.sh/@dimforge/rapier3d-compat@0.14.0'
  )).default;
  await RAPIER.init();


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

  const grid = new THREE.GridHelper(ARENA, 20, 0x2a5c30, 0x2a5c30);
  grid.position.y = 0.01;
  scene.add(grid);


  // ─── Fences ────────────────────────────────────────────────────────────────
  const FENCE_H = 1.5;
  const FENCE_T = 0.4;
  const FENCE_L = ARENA + 0.4;
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
  makeFence(0, -HALF, FENCE_L, FENCE_T);
  makeFence(0, HALF, FENCE_L, FENCE_T);
  makeFence(-HALF, 0, FENCE_T, FENCE_L);
  makeFence(HALF, 0, FENCE_T, FENCE_L);

  const INNER = HALF - FENCE_T / 2;


  // ─── Player (blue cube) ────────────────────────────────────────────────────
  const PLAYER_SIZE = 1;
  const PLAYER_HS = PLAYER_SIZE / 2;

  const player = new THREE.Mesh(
    new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE),
    new THREE.MeshLambertMaterial({ color: 0x1155ff })
  );
  player.position.set(0, PLAYER_HS, 0);
  player.castShadow = true;
  scene.add(player);

  const pv = { x: 0, z: 0 };
  const ACCEL = 0.1;
  const MAX_SPEED = 0.2;
  const FRICTION = 0.80;
  const BOUNCE = 0.65;


  // ─── Green cubes (static obstacles) ──────────────────────────────────────
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
    return { mesh };
  });



  // ─── Rapier world (top-down: no gravity, motion on XZ) ─────────────────────
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const FPS = 60;
  const DT = 1 / FPS;

  const WALL_THICK = 0.1;
  const WALL_HALF_H = FENCE_H / 2;

  function makeWallCollider(x, z, hx, hz) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, WALL_HALF_H, z)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, WALL_HALF_H, hz)
        // .setRestitution(BOUNCE)
        .setFriction(0.2),
      body
    );
  }
  makeWallCollider(0, -INNER, HALF, WALL_THICK);
  makeWallCollider(0, INNER, HALF, WALL_THICK);
  makeWallCollider(-INNER, 0, WALL_THICK, HALF);
  makeWallCollider(INNER, 0, WALL_THICK, HALF);

  for (const g of greens) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(g.position.x, GREEN_HS, g.position.z)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(GREEN_HS, GREEN_HS, GREEN_HS)
        .setRestitution(BALL_RESTITUTION)
        .setFriction(0.2),
      body
    );
  }

  const playerBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .enabledTranslations(true, false, true)
      .enabledRotations(false, false, false)
      .setTranslation(0, PLAYER_HS, 0)
      .setAdditionalMass(4)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(PLAYER_HS, PLAYER_HS, PLAYER_HS)
      .setRestitution(BOUNCE)
      .setFriction(0.15),
    playerBody
  );

  for (let i = 0; i < balls.length; i++) {
    const { mesh } = balls[i];
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .enabledTranslations(true, false, true)
        .enabledRotations(false, false, false)
        .setTranslation(mesh.position.x, BALL_R, mesh.position.z)
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_R)
        .setRestitution(BALL_RESTITUTION)
        .setFriction(0.1),
      body
    );
    balls[i].body = body;
  }


  // ─── Keyboard ──────────────────────────────────────────────────────────────
  const keys = {};
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });


  // ─── Physics update (input matches scene.js; Rapier resolves collisions) ───
  function updatePlayer() {
    if (keys['ArrowUp']) pv.z -= ACCEL;
    if (keys['ArrowDown']) pv.z += ACCEL;
    if (keys['ArrowLeft']) pv.x -= ACCEL;
    if (keys['ArrowRight']) pv.x += ACCEL;

    const spd = Math.sqrt(pv.x * pv.x + pv.z * pv.z);
    if (spd > MAX_SPEED) {
      pv.x = pv.x / spd * MAX_SPEED;
      pv.z = pv.z / spd * MAX_SPEED;
    }

    if (!keys['ArrowLeft'] && !keys['ArrowRight']) pv.x *= FRICTION;
    if (!keys['ArrowUp'] && !keys['ArrowDown']) pv.z *= FRICTION;

    if (Math.abs(pv.x) < 0.001) pv.x = 0;
    if (Math.abs(pv.z) < 0.001) pv.z = 0;

    playerBody.setLinvel({ x: pv.x * FPS, y: 0, z: pv.z * FPS }, true);
  }

  function syncMeshes() {
    const pt = playerBody.translation();
    player.position.set(pt.x, PLAYER_HS, pt.z);

    const plv = playerBody.linvel();
    pv.x = plv.x / FPS;
    pv.z = plv.z / FPS;
    if (Math.abs(pv.x) < 0.001) pv.x = 0;
    if (Math.abs(pv.z) < 0.001) pv.z = 0;

    for (const ball of balls) {
      const t = ball.body.translation();
      ball.mesh.position.set(t.x, BALL_R, t.z);

      const v = ball.body.linvel();
      let vx = v.x * BALL_FRICTION;
      let vz = v.z * BALL_FRICTION;
      if (Math.abs(vx) < 0.0005 * FPS) vx = 0;
      if (Math.abs(vz) < 0.0005 * FPS) vz = 0;
      ball.body.setLinvel({ x: vx, y: 0, z: vz }, true);
    }
  }


  // ─── Render loop ───────────────────────────────────────────────────────────
  function animate() {
    updatePlayer();
    world.timestep = DT;
    world.step();
    syncMeshes();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})().catch(err => console.error('Rapier scene failed to start:', err));
