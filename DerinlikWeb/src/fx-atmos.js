// fx-atmos: the air and the film response.
// - Tone mapping: AgX instead of ACES. ACES pushes bright tungsten and flame towards saturated orange/yellow and clips
//   bulbs into flat blobs; AgX rolls bright light off towards white the way a camera sensor (and the eye) does, and
//   keeps hue in the shadows. Exposure is retuned so mid-tones stay where the chapter grades expect them.
// - Air light: the flashlight lights the dust and moisture it passes through. The fog chunk of every built-in material
//   integrates single scattering of the torch cone along the view ray (a few jittered samples; the film grain hides
//   the dither): inverse distance from the torch (the torch itself uses linear decay), the cone's smooth edge, a
//   Henyey-Greenstein phase and extinction on both legs. Off on 'low' and in the headset (it costs per pixel and
//   the stereo view space differs per eye).
// All uniforms below are plain {x,y,z,w} objects: UniformsUtils.cloneUniforms copies Vector4s per material but keeps
// plain objects by reference, so one update per frame reaches every program.

renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.35;

const BEAM = {
  uBeamPos: { value: { x: 0, y: 0, z: 0, w: 0 } },   // xyz torch origin (view space), w sample count
  uBeamDir: { value: { x: 0, y: 0, z: -1, w: 1 } },  // xyz beam axis (view space), w cos(outer angle)
  uBeamCol: { value: { x: 0, y: 0, z: 0, w: 0 } },   // rgb radiance scale, w > 0 enables
  uBeamCone: { value: { x: 1, y: .25, z: 0, w: 22 } }, // x cos(inner angle), y phase anisotropy g, z jitter seed, w torch range
};
for (const sh of Object.values(THREE.ShaderLib)) if (sh.uniforms && sh.uniforms.fogDensity) Object.assign(sh.uniforms, BEAM);

const C = THREE.ShaderChunk;
C.fog_pars_vertex = C.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogPos;');
C.fog_vertex = C.fog_vertex.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvFogPos = mvPosition.xyz;');
C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;', /* glsl */`varying float vFogDepth;
	varying vec3 vFogPos;
	uniform vec4 uBeamPos; uniform vec4 uBeamDir; uniform vec4 uBeamCol; uniform vec4 uBeamCone;
	vec3 beamScatter( vec3 P, float sigma ) {
		float L = length( P ); vec3 V = P / max( L, 1e-4 );
		float t0 = min( L, .6 ), tMax = min( L, uBeamCone.w ), n = uBeamPos.w, dt = max( tMax - t0, 0.0 ) / n;  // the first .6 m: too close to the lens to read as a beam
		float j = fract( sin( dot( gl_FragCoord.xy + uBeamCone.z, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
		float g = uBeamCone.y, g2 = g * g;
		vec3 acc = vec3( 0.0 );
		for ( int i = 0; i < 12; i ++ ) {
			if ( float( i ) >= n ) break;
			float t = t0 + ( float( i ) + j ) * dt;
			vec3 X = V * t - uBeamPos.xyz; float d = length( X ); vec3 Ld = X / max( d, 1e-3 );
			float spot = smoothstep( uBeamDir.w, uBeamCone.x, dot( Ld, uBeamDir.xyz ) );
			float win = pow( clamp( 1.0 - pow( d / uBeamCone.w, 4.0 ), 0.0, 1.0 ), 2.0 );
			float cosT = dot( Ld, - V );                        // light travelling along Ld, scattered towards the eye
			float phase = ( 1.0 - g2 ) / ( 12.566 * pow( 1.0 + g2 - 2.0 * g * cosT, 1.5 ) );
			acc += spot * win * phase * exp( - sigma * ( t + d ) ) / max( d, .6 );
		}
		return uBeamCol.rgb * acc * sigma * dt;
	}`);
C.fog_fragment = C.fog_fragment.replace('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );', /* glsl */`gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#ifdef FOG_EXP2
		if ( uBeamCol.w > 0.0 ) gl_FragColor.rgb += beamScatter( vFogPos, fogDensity ) * gl_FragColor.a;
	#endif`);
if (!/vFogPos = mvPosition/.test(C.fog_vertex) || !/beamScatter\( vFogPos/.test(C.fog_fragment)) console.error('fx-atmos: three fog chunks changed; air light disabled');

// how much the air scatters relative to the fog density, per chapter: a dusty basement, dry tuff, damp concrete
// with ice haze, limestone dust with candle smoke
const DUST = [.3, .22, .34, .27];
let dust = DUST[0];
FX.on('chapter', (i) => { dust = DUST[i] ?? 1; });

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _inv = new THREE.Matrix4();
FX.on('draw', () => {
  const u = { pos: BEAM.uBeamPos.value, dir: BEAM.uBeamDir.value, col: BEAM.uBeamCol.value, cone: BEAM.uBeamCone.value };
  const on = torch.visible && torch.intensity > 0 && FX.quality !== 'low' && !renderer.xr.isPresenting && !!torch.parent;
  if (!on) { u.col.w = 0; return; }
  camera.updateMatrixWorld(); _inv.copy(camera.matrixWorld).invert();
  torch.getWorldPosition(_p).applyMatrix4(_inv); torch.target.getWorldPosition(_t).applyMatrix4(_inv); _t.sub(_p).normalize();
  u.pos.x = _p.x; u.pos.y = _p.y; u.pos.z = _p.z; u.pos.w = FX.quality === 'high' ? 10 : 6;
  u.dir.x = _t.x; u.dir.y = _t.y; u.dir.z = _t.z; u.dir.w = Math.cos(torch.angle);
  u.cone.x = Math.cos(torch.angle * (1 - torch.penumbra)); u.cone.z = (u.cone.z + 17.31) % 1000; u.cone.w = torch.distance || 22;
  const k = torch.intensity * dust;
  u.col.x = torch.color.r * k; u.col.y = torch.color.g * k; u.col.z = torch.color.b * k; u.col.w = 1;
});
