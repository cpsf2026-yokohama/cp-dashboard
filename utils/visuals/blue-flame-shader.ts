import * as THREE from 'three';

const fragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform float time, heightScale, turbulence, brightness, density;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p) {
  float v=0.; float a=.5;
  for(int i=0;i<4;i++){v+=a*noise(p);p=mat2(1.6,-1.2,1.2,1.6)*p+3.17;a*=.5;}
  return v;
}
// Sloped cell gradients avoid the plateaus of scalar lattice samples.
vec2 gradAt(vec2 cell){
  float angle=hash(cell)*6.2831853;
  return vec2(cos(angle),sin(angle));
}
float gradientNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  vec2 w=f*f*f*(f*(f*6.-15.)+10.);
  float a=dot(gradAt(i),f);
  float b=dot(gradAt(i+vec2(1,0)),f-vec2(1,0));
  float c=dot(gradAt(i+vec2(0,1)),f-vec2(0,1));
  float d=dot(gradAt(i+vec2(1,1)),f-vec2(1,1));
  return mix(mix(a,b,w.x),mix(c,d,w.x),w.y);
}
float flameDensity(vec2 q,float y){
  vec2 p=q*vec2(4.52,1.04);
  float base=fbm(p);
  vec2 r=mat2(.925,-.380,.380,.925)*p+vec2(7.1,1.4);
  float gradient=.48+.56*gradientNoise(r)+.16*gradientNoise(r*1.97+4.1);
  return mix(base,gradient,0.65*smoothstep(.17,.67,y));
}
// A continuous upward velocity field with two scales of sideways eddies.
vec2 velocity(vec2 p,float t){
  float wide=noise(p*vec2(2.5,2.0)+vec2(2.1,t*.27))-.5;
  float small=noise(p*vec2(5.3,4.4)+vec2(7.2,-t*.39))-.5;
  return vec2((wide*.90+small*.32)*turbulence,
    .54+p.y*.28 + .15*wide+.08*small);
}
void main(){
  float t=time;
  vec2 p=vec2(vUv.x*resolution.x/resolution.y*density,vUv.y/heightScale);
  // Backtrace along the flow with midpoint integration. Time at the source
  // varies with travel distance, so the inlet pattern stretches into tongues.
  vec2 from=p;
  float travel=p.y/(.54+.14*p.y);
  float dt=travel/3.;
  for(int k=0;k<3;k++){
    float tk=t-float(k)*dt;
    vec2 v=velocity(from,tk);
    from-=velocity(from-v*.5*dt,tk-.5*dt)*dt;
  }
  vec2 q=vec2(from.x,p.y*.12-(t-travel)*.55);
  vec2 warp=vec2(fbm(q*vec2(3.2,2.0)+vec2(5.4,3.1)),
                 fbm(q*vec2(2.1,3.4)+vec2(1.7,8.2)))-.46;
  q+=warp*vec2(.34,.21)*turbulence*smoothstep(.0,.55,p.y);
  // Different parts of a broad tongue rise at different rates. A
  // variable phase shears the cap before it detaches and fades.
  float shear=noise(q*vec2(5.4,1.0)+vec2(8.3,12.1));
  float lift=smoothstep(.24,.78,p.y);
  q.y+=(shear-.5)*.64*lift;
  q.x+=(shear-.5)*.10*lift;
  float large=flameDensity(q,p.y);
  float mid=fbm(q*vec2(7.8,2.4)+vec2(3.5,5.0));
  float fine=noise(q*vec2(16.,6.2)+vec2(7.8,4.3));
  float supply=noise(vec2(from.x*2.25,3.91));
  float pulse=noise(vec2(from.x*2.9,(t-travel)*.59+9.1));
  // Only the concentrated channels feed the taller, narrow tongues.
  float channel=noise(q*vec2(4.9,.54)+vec2(9.3,4.8));
  float jet=smoothstep(.50,.86,channel);
  float limit=mix(.30,1.05,supply*.40+pulse*.21+jet*.39);

  float field=.56-p.y*.43+(large-.48)*1.22+(mid-.48)*.31;
  field-=(.5-fine)*.085*smoothstep(.23,.80,p.y);
  float edge=max(mix(.043,.026,smoothstep(.25,.80,p.y)),fwidth(field)*1.22);
  float tip=smoothstep(.23,.79,p.y);
  field+=tip*(jet-.40)*.32;
  float strands=noise(q*vec2(9.7,.89)+vec2(7.8,9.3));
  float neck=smoothstep(.25,.74,strands);
  float cut=.28+tip*(.020+.065*smoothstep(.38,.66,1.-mid)+.065*(1.-jet))
    +lift*.23*(1.-neck);
  // The body loses light over a range of travel times. Broad weak
  // flame fades earlier than the narrow, fuel-rich tongues.
  float shape=clamp((field-cut)*2.6,0.,1.);
  float lifetime=(limit/(.54+.14*limit))*(.86+.19*jet);
  float age=travel/max(.15,lifetime);
  float life=1.-smoothstep(.54,1.24,age + (1.-jet)*.15 - shape*.16 + lift*(shear-.5)*.31);
  // Compare with the same flow slightly below the pixel. Detached parts
  // can survive briefly, but lose emission faster than fed tongues.
  // Estimate whether a thin parcel still has a luminous connection
  // below it, using two samples along its upstream direction.
  vec2 up1=q-vec2(0.,.19);
  vec2 up2=q-vec2(0.,.33);
  float support1=.56-max(0.,p.y-.18)*.43
    +(flameDensity(up1,max(0.,p.y-.18))-.48)*1.22;
  float support2=.56-max(0.,p.y-.31)*.43
    +(flameDensity(up2,max(0.,p.y-.31))-.48)*1.22;
  float fed=smoothstep(.25,.42,min(support1,support2));
  float separated=smoothstep(.35,.72,p.y)*(1.-fed);
  life*=1.-separated*.86;
  life*=1.-lift*(1.-neck)*.30;
  float body=smoothstep(cut-edge*.3,cut+edge,field)*life;
  float core=smoothstep(.30,.69,field);
  float detail=fbm(q*vec2(4.6,2.7)+vec2(11.2,7.1));
  float heat=clamp((.71-p.y*1.40)+(detail-.50)*.56+core*.20,0.,1.);
  vec3 black=vec3(.018,.016,.024);
  vec3 navy=vec3(.018,.050,.225);
  vec3 blue=vec3(.023,.143,.365);
  vec3 cyan=vec3(.142,.385,.449);
  vec3 ramp=mix(navy,blue,smoothstep(.15,.59,heat));
  ramp=mix(ramp,cyan,smoothstep(.44,.95,heat));
  float pocket=smoothstep(.54,.70,detail)*(1.-smoothstep(.03,.16,p.y));
  // Inner sheets move with the same flow as the outline. Keep the outer
  // density intact while allowing the darker interior to show through.
  vec2 chamberUV=q*vec2(4.1,1.78)+vec2(6.7,2.1);
  chamberUV+=vec2((mid-.48)*.62,(large-.48)*.47);
  float hollowSignal=mix(noise(chamberUV),noise(chamberUV*.61+4.7),.30);
  float filled=smoothstep(cut+.028,cut+.17,field);
  float upper=smoothstep(.16,.39,p.y)*(1.-smoothstep(.79,1.06,p.y));
  float cavity=smoothstep(.41,.65,hollowSignal)*filled*upper;
  float lip=smoothstep(.37,.51,hollowSignal)*(1.-smoothstep(.51,.66,hollowSignal));
  float veil=1.-smoothstep(.38,.63,hollowSignal);
  float plume=smoothstep(.10,.28,p.y)*(1.-smoothstep(.56,.86,p.y));
  vec3 membrane=ramp+vec3(.010,.037,.064)*lip*filled*upper;
  membrane+=vec3(.010,.039,.074)*veil*plume*filled;
  float opacity=body*(.56+.36*core)*(1.-pocket*.56)*(1.-cavity*0.77);
  vec3 col=mix(black,membrane,opacity);

  // The roots share the inlet and the backtraced flow of the upper flame.
  // A weak bed joins neighboring tongues, while local pulses carry the light.
  vec2 bedUV=vec2(q.x*3.45 + (large-.48)*.55,
                 q.y*3.4 + (mid-.48)*1.15);
  float bend=noise(bedUV+vec2(3.1,4.8));
  float rising=noise(bedUV*vec2(1.71,.65)+vec2(14.2,2.6));
  float fuelBed=.62*bend+.38*rising;
  float crest=.065+.19*smoothstep(.18,.78,supply*.50+fuelBed*.50);
  float ground=1.-smoothstep(crest*.13,crest,p.y);
  float tongue=smoothstep(.30,.71,fuelBed);
  float fold=smoothstep(.32,.54,fuelBed)*(1.-smoothstep(.54,.76,fuelBed));
  vec3 bed=mix(vec3(.012,.036,.091),vec3(.110,.321,.385),fold);
  float connected=.15+.85*smoothstep(.13,.49,field);
  float amount=ground*(.095+.47*tongue)*connected;
  col+=bed*amount*.61;
  float grain=(hash(gl_FragCoord.xy)-.5)*.004;
  gl_FragColor=vec4(max(col*brightness+grain,vec3(0.)),1.);
}`;

export function createBlueFlameRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  const uniforms = {
    resolution: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
    heightScale: { value: 1 }, turbulence: { value: .65 },
    brightness: { value: 2 }, density: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.Camera();
  // Bloom picks up just the brighter blue-green light, at a small radius.
  const target = new THREE.WebGLRenderTarget(1, 1, {depthBuffer: false});
  const postMaterial = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {
      source: {value: target.texture}, stepUV: {value: new THREE.Vector2(1, 1)},
    },
    vertexShader: material.vertexShader,
    fragmentShader: `
      uniform sampler2D source;
      uniform vec2 stepUV;
      varying vec2 vUv;
      vec3 bright(vec2 uv){
        vec3 c=texture2D(source,uv).rgb;
        return c*smoothstep(.12,.28,c.g);
      }
      void main(){
        vec3 c=texture2D(source,vUv).rgb;
        vec3 halo=vec3(0.);
        for(int i=0;i<8;i++){
          float a=float(i)*.78539816;
          vec2 d=vec2(cos(a),sin(a))*stepUV;
          halo+=bright(vUv+d)*.70+bright(vUv+d*2.)*.30;
        }
        gl_FragColor=vec4(c+halo*.024,1.);
      }
    `,
  });
  const postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(geometry, postMaterial));
  return {
    resize(width: number, height: number) {
      const scale = Math.min(window.devicePixelRatio || 1, 1.25, 1600 / width);
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      renderer.setSize(w, h, false);
      target.setSize(w, h);
      uniforms.resolution.value.set(width, height);
      postMaterial.uniforms.stepUV.value.set(3 / width, 3 / height);
    },
    draw(time: number) {
      uniforms.time.value = time;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, camera);
    },
    dispose() {
      target.dispose();
      geometry.dispose();
      material.dispose();
      postMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
