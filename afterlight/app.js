import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mobile = window.matchMedia('(max-width: 800px)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = $('#universe');
const chapters = [...document.querySelectorAll('.chapter')];
const nav = [...document.querySelectorAll('.chapter-link')];
const progressFill = $('#progress-fill');
const percentLabel = $('#percent-label');
const chapterCount = $('#chapter-count');
const loadFill = $('#load-fill');
const loadNumber = $('#load-number');
const loader = $('#loader');
const flash = $('#flash');
const fallback = $('#fallback-message');
let scene, camera, renderer, universe, orb, orbMaterial, halo, rings = [], shards, stars, portals = [], spirals = [];
let targetMouse = { x: 0, y: 0 }, mouse = { x: 0, y: 0 }, scroll = 0, smoothScroll = 0;
let pulse = 0, frame = 0, activeChapter = -1, spinning = 0;
let startTime = performance.now();
let audioContext, masterGain, oscillators = [], soundPlaying = false;
const colors = [0xa7b2ff, 0x9b89ff, 0x8ae0ff, 0xf2e6ff, 0x6573ff];
const temp = new THREE.Object3D();
const shardData = [];

function updateUI() {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  scroll = clamp(window.scrollY / Math.max(1, window.innerHeight), 0, 3);
  const pct = clamp(window.scrollY / maxScroll, 0, 1);
  const idx = clamp(Math.round(scroll), 0, 3);
  progressFill.style.width = (pct * 100).toFixed(2) + '%';
  percentLabel.textContent = String(Math.round(pct * 100)).padStart(3, '0') + '%';
  chapterCount.textContent = String(idx + 1).padStart(2, '0') + ' / 04';
  $('#scroll-label').textContent = pct > .96 ? 'BACK TO THE BEGINNING' : 'SCROLL TO EXPLORE';
  if (idx !== activeChapter) {
    activeChapter = idx;
    chapters.forEach((c, i) => c.classList.toggle('is-active', i === idx));
    nav.forEach((c, i) => {
      c.classList.toggle('current', i === idx);
      if (i === idx) c.setAttribute('aria-current', 'location');
      else c.removeAttribute('aria-current');
    });
  }
}
window.addEventListener('scroll', updateUI, { passive: true });
window.addEventListener('resize', () => { updateUI(); resize(); }, { passive: true });

function triggerPulse(strength = 1) {
  pulse = Math.max(pulse, strength);
  spinning += 1.7 * strength;
  flash.classList.remove('active');
  void flash.offsetWidth;
  flash.classList.add('active');
  if (soundPlaying && audioContext) {
    const now = audioContext.currentTime;
    const o = audioContext.createOscillator();
    const g = audioContext.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(480, now);
    o.frequency.exponentialRampToValueAtTime(68, now + .7);
    g.gain.setValueAtTime(.0001, now);
    g.gain.exponentialRampToValueAtTime(.10, now + .03);
    g.gain.exponentialRampToValueAtTime(.0001, now + .85);
    o.connect(g).connect(audioContext.destination); o.start(now); o.stop(now + .87);
  }
}
$('#distort-button').addEventListener('click', () => triggerPulse(1.25));
$('#shatter-button').addEventListener('click', () => triggerPulse(1.8));
$('#warp-button').addEventListener('click', () => triggerPulse(2.3));
canvas.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') triggerPulse(.8); });
window.addEventListener('pointermove', e => {
  targetMouse.x = (e.clientX / innerWidth) * 2 - 1;
  targetMouse.y = -(e.clientY / innerHeight) * 2 + 1;
}, { passive: true });

function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioContext = new Ctx();
  masterGain = audioContext.createGain();
  masterGain.gain.value = .0001;
  masterGain.connect(audioContext.destination);
  for (const [freq, vol, type] of [[55, .14, 'sine'], [82.41, .06, 'sine'], [110.15, .022, 'triangle'], [164.8, .013, 'sine']]) {
    const o = audioContext.createOscillator(), g = audioContext.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g).connect(masterGain); o.start(); oscillators.push(o);
  }
}
$('#sound-toggle').addEventListener('click', async () => {
  try {
    if (!audioContext) createAudio();
    if (!audioContext) return;
    await audioContext.resume();
    soundPlaying = !soundPlaying;
    masterGain.gain.cancelScheduledValues(audioContext.currentTime);
    masterGain.gain.setTargetAtTime(soundPlaying ? .075 : .0001, audioContext.currentTime, .25);
    document.body.classList.toggle('sound-on', soundPlaying);
    $('#sound-toggle').setAttribute('aria-pressed', String(soundPlaying));
    $('#sound-label').textContent = soundPlaying ? 'SOUND ON' : 'SOUND OFF';
  } catch(e) { console.warn('Audio unavailable', e); }
});

function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, .1, 150);
  camera.position.set(0, 0, 10);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.85));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  universe = new THREE.Group();
  scene.add(universe);

  // The living pearl: procedurally deformed geometry and electric Fresnel.
  const vertex = `
    uniform float uTime; uniform float uPulse; uniform float uScroll;
    varying vec3 vWorldNormal; varying vec3 vWorldPosition; varying vec3 vLocal;
    varying float vDisplace;
    void main() {
      vec3 p = position;
      float a = sin(p.x * 3.8 + uTime * .72) * sin(p.y * 3.2 - uTime * .53) * sin(p.z * 3.5 + uTime * .37);
      float b = sin((p.x + p.y) * 6.2 + uTime * 1.3) * sin(p.z * 5.4 - uTime);
      float c = sin(length(p.xy) * 10.0 - uTime * 1.6 + p.z * 2.0);
      float strength = .105 + uPulse * .18 + smoothstep(.6,1.5,uScroll)*.10;
      float displacement = a * strength + b * .035 + c * (.025 + uPulse*.04);
      p += normal * displacement;
      vLocal = p; vDisplace = displacement;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vec4 world = modelMatrix * vec4(p,1.);
      vWorldPosition = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;
  const fragment = `
    precision highp float;
    uniform float uTime; uniform float uPulse; uniform float uScroll; uniform float uOpacity;
    varying vec3 vWorldNormal; varying vec3 vWorldPosition; varying vec3 vLocal; varying float vDisplace;
    void main() {
      vec3 n = normalize(vWorldNormal);
      vec3 eye = normalize(cameraPosition - vWorldPosition);
      float fresnel = pow(1. - abs(dot(eye,n)), 2.45);
      vec3 light = normalize(vec3(-.5,.95,1.25));
      float diffuse = max(dot(n,light),0.);
      float shimmer = sin(vLocal.y*4.8+vLocal.x*2.1+uTime*.54 + sin(vLocal.z*5.))*.5+.5;
      float veins = pow(max(0., sin(vLocal.x*13.5 + vLocal.y*8.0 + vLocal.z*5.0 + sin(vLocal.y*7.+uTime)*1.7)),16.);
      vec3 deep = vec3(.035,.040,.14);
      vec3 lavender = vec3(.30,.25,.72);
      vec3 ice = vec3(.53,.78,.96);
      vec3 base = mix(deep,lavender,.36+.44*shimmer);
      base = mix(base,ice,pow(max(n.y*.5+.5,0.),1.8)*.47);
      base *= .60 + diffuse * .87;
      vec3 reflection = vec3(.52,.60,1.0) * fresnel * (1.35+uPulse*.72);
      vec3 highlight = vec3(.85,.9,1.) * pow(diffuse,9.) * .52;
      vec3 color = base + reflection + highlight + veins*.055;
      color += vec3(.12,.07,.26) * vDisplace*2.;
      color += vec3(.06,.04,.12) * sin(uScroll*1.9);
      color = 1. - exp(-color*1.45);
      gl_FragColor = vec4(color, uOpacity);
    }
  `;
  orbMaterial = new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment,
    uniforms: { uTime: {value:0}, uPulse:{value:0}, uScroll:{value:0}, uOpacity:{value:1} },
    transparent: true, side: THREE.FrontSide, depthWrite: true
  });
  orb = new THREE.Mesh(new THREE.SphereGeometry(1.63, mobile ? 80 : 128, mobile ? 56 : 88), orbMaterial);
  universe.add(orb);
  halo = new THREE.Mesh(new THREE.IcosahedronGeometry(1.77, 3), new THREE.MeshBasicMaterial({color:0x999dff,wireframe:true,transparent:true,opacity:.08,depthWrite:false,blending:THREE.AdditiveBlending}));
  universe.add(halo);

  // Tilted orbital blades catch light differently at every rotation.
  for (let i=0;i<9;i++) {
    const radius = 2.03 + i*.115;
    const tube = i%3===0 ? .013 : .0048;
    const m = new THREE.MeshBasicMaterial({color:colors[i%colors.length], transparent:true, opacity:i%3===0 ? .38 : .19, blending:THREE.AdditiveBlending, depthWrite:false});
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius,tube,8,200),m);
    ring.rotation.set(.25+i*.51, .3+i*1.1, i*.57);
    ring.userData = { rx:ring.rotation.x, ry:ring.rotation.y, rz:ring.rotation.z, speed: i%2===0?1:-1, opacity:m.opacity };
    rings.push(ring); universe.add(ring);
  }

  // A field of little metallic satellites. Instanced to stay fast on phones.
  const shardCount = mobile ? 190 : 440;
  const geom = new THREE.OctahedronGeometry(.028, 0);
  const mat = new THREE.MeshBasicMaterial({color:0xb7baff, transparent:true,opacity:.83,blending:THREE.AdditiveBlending,depthWrite:false});
  shards = new THREE.InstancedMesh(geom,mat,shardCount);
  shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i=0;i<shardCount;i++) {
    const theta = Math.random()*Math.PI*2, z = Math.random()*2-1, xy=Math.sqrt(1-z*z);
    shardData.push({x:xy*Math.cos(theta), y:xy*Math.sin(theta), z, radius: 2.3+Math.random()*4.8, offset:Math.random()*Math.PI*2, speed:.15+Math.random()*.8, scale:.25+Math.random()*2.8});
  }
  universe.add(shards);

  // The distant stars are a separate depth layer.
  const starCount = mobile ? 1500 : 3500;
  const positions = new Float32Array(starCount*3), starColors = new Float32Array(starCount*3);
  for(let i=0;i<starCount;i++){
    const k=i*3; positions[k]=(Math.random()-.5)*65; positions[k+1]=(Math.random()-.5)*42; positions[k+2]=-10-Math.random()*65;
    const tint=Math.random(); starColors[k]=tint>.75?.65:.31; starColors[k+1]=tint>.65?.68:.45; starColors[k+2]=.75+Math.random()*.25;
  }
  const sg=new THREE.BufferGeometry();
  sg.setAttribute('position',new THREE.BufferAttribute(positions,3));
  sg.setAttribute('color',new THREE.BufferAttribute(starColors,3));
  stars=new THREE.Points(sg,new THREE.PointsMaterial({size:mobile?.04:.055,vertexColors:true,transparent:true,opacity:.7,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
  scene.add(stars);

  // Rings recede in z to create the hyperdrive tunnel.
  const portalGroup = new THREE.Group();
  for(let i=0;i<24;i++){
    const m=new THREE.MeshBasicMaterial({color:colors[i%colors.length],transparent:true,opacity:.001,blending:THREE.AdditiveBlending,depthWrite:false});
    const mesh=new THREE.Mesh(new THREE.TorusGeometry(1.75 + .05*i,.012+(i%5===0?.015:0),5,120),m);
    mesh.position.z= -i*.51+.5; mesh.rotation.z=i*.165; mesh.userData = {index:i};
    portals.push(mesh); portalGroup.add(mesh);
  }
  for (let i=0;i<5;i++){
    const pts=[];
    for(let j=0;j<=440;j++){
      const t=j/440, angle=t*Math.PI*13+i*Math.PI*2/5;
      const r=.2+2.45*t;
      pts.push(new THREE.Vector3(r*Math.cos(angle),r*Math.sin(angle),-7+t*9));
    }
    const curve=new THREE.BufferGeometry().setFromPoints(pts);
    const line=new THREE.Line(curve,new THREE.LineBasicMaterial({color:colors[i],transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
    spirals.push(line);portalGroup.add(line);
  }
  portalGroup.position.z=-.7;
  universe.add(portalGroup);

  resize();
  document.body.classList.add('js-enabled');
  updateUI();
  animate();
}

function resize(){
  if(!renderer) return;
  camera.aspect=innerWidth/innerHeight; camera.fov=mobile?48:43; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight,false);
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, mobile?1.5:1.85));
}

function animate(){
  requestAnimationFrame(animate);
  if(document.hidden) return;
  frame++;
  const t=(performance.now()-startTime)*.001;
  const d=reducedMotion?.025:.055;
  smoothScroll=lerp(smoothScroll,scroll,d);
  mouse.x=lerp(mouse.x,targetMouse.x,.025);
  mouse.y=lerp(mouse.y,targetMouse.y,.025);
  pulse=Math.max(0,pulse*.948-.003);
  spinning*=.966;

  // The four worlds blend continuously, with no hard cuts.
  const matter=smoothstep(.4,1.0,smoothScroll)*(1.-smoothstep(1.6,2.05,smoothScroll));
  const hyper=smoothstep(1.55,2.2,smoothScroll)*(1.-smoothstep(2.55,3.,smoothScroll));
  const rebirth=smoothstep(2.5,3.,smoothScroll);
  const targetX=mobile?0:1.84 + .15*Math.sin(smoothScroll*1.8);
  const targetY=mobile?1.12:-.05;
  universe.position.x=lerp(universe.position.x,targetX,.035);
  universe.position.y=lerp(universe.position.y,targetY,.035);
  universe.rotation.y=lerp(universe.rotation.y,mouse.x*.16+.16*Math.sin(t*.18),.03);
  universe.rotation.x=lerp(universe.rotation.x,-mouse.y*.12,.03);
  const s=(1.-hyper*.58)+pulse*.065+rebirth*.13;
  orb.scale.setScalar(lerp(orb.scale.x,s,.065));
  orb.rotation.y=t*(reducedMotion?.018:.095)+spinning*.25+mouse.x*.16;
  orb.rotation.z=t*(reducedMotion?.008:.035);
  orbMaterial.uniforms.uTime.value=reducedMotion?2:t;
  orbMaterial.uniforms.uPulse.value=pulse;
  orbMaterial.uniforms.uScroll.value=smoothScroll;
  orbMaterial.uniforms.uOpacity.value=1.-hyper*.67;
  halo.scale.setScalar(orb.scale.x*1.03);
  halo.rotation.x=-t*.05;halo.rotation.y=t*.08;
  halo.material.opacity=(.07+matter*.12)*(1.-hyper*.8);

  for(let i=0;i<rings.length;i++){
    const r=rings[i],u=r.userData;
    r.rotation.x=u.rx+t*.035*u.speed; r.rotation.y=u.ry+t*.044*u.speed;
    r.rotation.z=u.rz+t*.027*u.speed+spinning*.14;
    r.scale.setScalar(1.+matter*.12+hyper*.75+rebirth*.03);
    r.material.opacity=u.opacity*(.88+matter*.43)*(1.-hyper*.45);
  }
  const intensity=1+matter*.72+hyper*1.9+pulse*1.7;
  const dummy=temp;
  for(let i=0;i<shardData.length;i++){
    const v=shardData[i];
    const a=t*v.speed*.17+v.offset;
    const ca=Math.cos(a),sa=Math.sin(a);
    const x=v.x*ca-v.z*sa, z=v.x*sa+v.z*ca;
    const r=v.radius*intensity;
    dummy.position.set(x*r,v.y*r+Math.sin(t*.6+v.offset)*.06,z*r);
    dummy.rotation.set(t*.23+v.offset,t*.31-v.offset,0);
    dummy.scale.setScalar(v.scale*(.8+matter*.5+hyper*.55+pulse*.5));
    dummy.updateMatrix();
    shards.setMatrixAt(i,dummy.matrix);
  }
  shards.instanceMatrix.needsUpdate=true;
  shards.rotation.z=t*.019;
  stars.rotation.z=t*.0015;stars.rotation.y=mouse.x*.012;
  stars.material.opacity=.48+Math.sin(t*.6)*.11+hyper*.3;

  for(let i=0;i<portals.length;i++){
    const ring=portals[i];
    const depth=(t*.95+i*.23)%5;
    ring.material.opacity=hyper*(.10+.55*(1.-i/portals.length)) + pulse*.04*hyper;
    ring.scale.setScalar(1+hyper*1.35+Math.sin(t*.3+i*.2)*.015);
    ring.rotation.z=i*.20+t*.055*(i%2?1:-1);
    ring.position.z=-i*.51+.5+hyper*depth*.11;
  }
  for(let i=0;i<spirals.length;i++){
    spirals[i].material.opacity=hyper*(.26+i*.04);
    spirals[i].rotation.z=t*.08*(i%2?1:-1);
  }
  camera.position.x=lerp(camera.position.x,mouse.x*.21,.025);
  camera.position.y=lerp(camera.position.y,mouse.y*.14,.025);
  camera.position.z=lerp(camera.position.z,10.-hyper*1.2-pulse*.27,.03);
  camera.lookAt(0,0,0);
  renderer.render(scene,camera);
}

async function begin(){
  try {
    loadNumber.textContent='37';loadFill.style.width='37%';
    init();
    loadNumber.textContent='100';loadFill.style.width='100%';
    fallback.hidden=true;
    setTimeout(()=>loader.classList.add('dismissed'), 350);
  }catch(error){
    console.error('AFTERLIGHT WebGL could not initialize',error);
    loader.classList.add('dismissed');
    fallback.hidden=false;
    document.body.classList.remove('js-enabled');
    // CSS atmosphere remains usable even without WebGL.
  }
}
begin();
