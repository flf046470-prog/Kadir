// Contact shading: where a wall, a pillar or a crate meets the floor or the ceiling, light is blocked and dirt collects,
// so real rooms are darker in their corners and along every skirting. The game has no screen-space AO (fx-post.js: it
// crashed the software GPU), so this bakes the effect into the level instead: soft dark gradients on the faces of every
// box that stands on the floor or touches the ceiling, on the floor beside it, and under the Blender props that collide.
// They share one material, so the static batcher (game.html batchStatic) merges a chapter's gradients into one draw call.
{
  const BASE_H = .42, FLOOR_W = .34, CEIL_H = .32, LIFT = .003;
  const grad = (() => {          // alpha falls from 1 at v = 0 (the contact line) to 0 at v = 1, eased like real AO
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 128; const g = cv.getContext('2d');
    const img = g.createImageData(4, 128);
    for (let y = 0; y < 128; y++) {
      const v = y / 127, a = Math.pow(1 - v, 2.2) * (.75 + .25 * (1 - v));
      for (let x = 0; x < 4; x++) { const i = (y * 4 + x) * 4; img.data[i + 3] = Math.round(a * 255); }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.flipY = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; return tex;
  })();
  const contactMat = new THREE.MeshBasicMaterial({ map: grad, color: 0x000000, transparent: true, opacity: .62, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  matCache.__contact = contactMat;        // registered as shared, so batchStatic merges every strip of a chapter

  // a quad: corner p, edge u (along the contact line), edge v (away from it); uv.y = 0 on the contact line.
  // flat > 0: the whole quad takes the gradient's value at that height (an even shade under a prop)
  function strip(p, u, v, flat = 0) {
    const P = new THREE.Vector3(...p), U = new THREE.Vector3(...u), V = new THREE.Vector3(...v);
    const pts = [P, P.clone().add(U), P.clone().add(U).add(V), P.clone().add(V)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((q) => q.toArray()), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(flat ? [.5, flat, .5, flat, .5, flat, .5, flat] : [0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]);    // both windings: seen from either side
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, contactMat); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 1; W.group.add(m);
  }

  function shade([x0, y0, z0], [x1, y1, z1], { floorY, ceilY, faces: onFaces }) {
    const e = LIFT;
    if (!onFaces && floorY != null) strip([x0 - .04, floorY + e, z0 - .04], [x1 - x0 + .08, 0, 0], [0, 0, z1 - z0 + .08], .2);
    const faces = [   // the four vertical faces: a point at the face's floor corner, its length, its outward normal
      { p: [x0, z0 - e], u: [x1 - x0, 0, 0], n: [0, -1] }, { p: [x0, z1 + e], u: [x1 - x0, 0, 0], n: [0, 1] },
      { p: [x0 - e, z0], u: [0, 0, z1 - z0], n: [-1, 0] }, { p: [x1 + e, z0], u: [0, 0, z1 - z0], n: [1, 0] },
    ];
    for (const { p: [px, pz], u, n: [nx, nz] } of faces) {
      if (Math.hypot(...u) < .05) continue;
      if (floorY != null) {
        if (onFaces) strip([px, floorY + e, pz], u, [0, Math.min(BASE_H, (y1 - y0) * .6), 0]);         // up the face
        strip([px + nx * e, floorY + e, pz + nz * e], u, [nx * FLOOR_W, 0, nz * FLOOR_W]);           // out on the floor
      }
      if (ceilY != null && onFaces) {
        strip([px, ceilY - e, pz], u, [0, -Math.min(CEIL_H, (y1 - y0) * .5), 0]);                    // down from the ceiling
        strip([px + nx * e, ceilY - e, pz + nz * e], u, [nx * FLOOR_W * .8, 0, nz * FLOOR_W * .8]);   // out on the ceiling
      }
    }
  }

  FX.on('build', () => {
    W.group.updateMatrixWorld(true);
    const floors = [], ceils = [], solids = [];
    for (const o of [...W.group.children]) {
      const isBox = o.isMesh && o.geometry && o.geometry.type === 'BoxGeometry';
      if (!isBox && !(o.userData.collider && !o.isMesh)) continue;   // boxes, and Blender props that collide (their bounds)
      if (o.userData.dynamic || !o.visible) continue;                // doors and slabs move: their dirt would stay behind
      const b = new THREE.Box3().setFromObject(o), min = b.min.toArray(), max = b.max.toArray(), s = o.userData.surface;
      if (s === 'floor') floors.push({ min, max }); else if (s === 'ceiling') ceils.push({ min, max }); else solids.push({ min, max, prop: !isBox });
    }
    const over = (a, b) => a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[2] < b.max[2] && a.max[2] > b.min[2];
    for (const s of solids) {
      if (s.max[1] - s.min[1] < .12) continue;                       // planks, ledges: no contact worth shading
      const fl = floors.find((f) => over(s, f) && Math.abs(f.max[1] - s.min[1]) < .06);
      const ce = ceils.find((c) => over(s, c) && Math.abs(c.min[1] - s.max[1]) < .06);
      // a Blender prop is not a box: only the floor round and under its bounds darkens, nothing is drawn on air
      if (fl || ce) shade(s.min, s.max, { floorY: fl ? fl.max[1] : null, ceilY: ce ? ce.min[1] : null, faces: !s.prop });
    }
  });
}
