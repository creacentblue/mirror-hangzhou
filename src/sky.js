// 光照 / 天空 / 雾 / 雨雪：根据本地时间 + 实时天气，计算整个场景的环境参数
import * as THREE from 'three';
import { PAL } from './world.js';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixv = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

export const U = {
  uPal: { value: PAL.map(c => V3(c[0], c[1], c[2])) },
  uSunDir: { value: V3(0.3, 0.8, 0.3) }, uSunCol: { value: V3(1, .95, .85) }, uAmbSky: { value: V3(.4, .5, .7) }, uAmbGnd: { value: V3(.3, .3, .3) },
  uFogCol: { value: V3(.7, .8, .9) }, uFogD: { value: 0.0012 }, uNight: { value: 0 }, uWet: { value: 0 },
  uLampPos: { value: V3() }, uLampDir: { value: V3(0, 0, -1) }, uLampI: { value: 0 }, uLampCos: { value: 0.88 },
};
export const ENV = { sunElev: 0.5, night: 0, fogCol: [.7, .8, .9], cloud: 0, rain: 0, snow: 0, wind: [0, 0], speed: 0, hor: [.7, .8, .9] };

export function voxelMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `
      attribute float aType; attribute float aNorm;
      varying vec3 vP; varying float vT; varying float vN; varying float vDist;
      void main(){ vP=position; vT=aType; vN=aNorm; vec4 mv=modelViewMatrix*vec4(position,1.0); vDist=length(mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `
      precision highp float;
      uniform vec3 uPal[32]; uniform vec3 uSunDir,uSunCol,uAmbSky,uAmbGnd,uFogCol,uLampPos,uLampDir; uniform float uFogD,uNight,uWet,uLampI,uLampCos;
      varying vec3 vP; varying float vT; varying float vN; varying float vDist;
      float h31(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        int ni=int(vN+0.5);
        vec3 N = ni==0?vec3(1,0,0): ni==1?vec3(-1,0,0): ni==2?vec3(0,1,0): ni==3?vec3(0,-1,0): ni==4?vec3(0,0,1):vec3(0,0,-1);
        vec3 vox=floor(vP-N*0.5); int t=int(vT+0.5);
        vec3 col=uPal[t]; float h=h31(vox);
        float vr=(t==2||t==8||t==28||t==29||t==15)?0.15:(t==4||t==6||t==11)?0.08:0.05;
        col*=1.0+(h-0.5)*vr*2.0;
        vec3 f=abs(fract(vP)-0.5)*(1.0-abs(N)); float edge=max(f.x,max(f.y,f.z));
        col*=1.0-smoothstep(0.455,0.5,edge)*0.16*(1.0-smoothstep(40.0,130.0,vDist));
        vec3 emis=vec3(0.0);
        if(t==10||t==27){
          float c=abs(N.x)>0.5?vox.z:vox.x;
          if(mod(c,4.0)<0.5){ col=uPal[12]*0.8; }
          else { float lit=step(0.62,h31(vox+vec3(3.1,1.7,9.2)))*uNight; col=mix(col,uFogCol*0.9,0.18*(1.0-uNight)); emis=vec3(1.0,0.80,0.46)*lit*0.95; col*=1.0-lit*0.6; }
        }
        float wet=uWet*((t==3||t==4||t==6||t==7||t==2)?1.0:0.4); col*=1.0-0.22*wet;
        float nl=max(dot(N,uSunDir),0.0);
        vec3 light=mix(uAmbGnd,uAmbSky,N.y*0.5+0.5)+uSunCol*nl;
        vec3 wp=vP*1.5; vec3 L=uLampPos-wp; float ld=length(L); L/=max(ld,0.001);
        float spot=smoothstep(uLampCos,uLampCos+0.1,dot(-L,uLampDir))*(1.0-smoothstep(4.0,48.0,ld))*max(dot(N,L),0.0)*uLampI;
        light+=vec3(1.0,0.92,0.72)*spot*1.4;
        vec3 c=col*light+emis;
        float fog=1.0-exp(-uFogD*uFogD*vDist*vDist);
        c=mix(c,uFogCol,fog);
        gl_FragColor=vec4(c,1.0);
      }`,
  });
}

export function makeSky() {
  const uni = { uZen: { value: V3() }, uHor: { value: V3() }, uSun: { value: V3(0, 1, 0) }, uSunGlow: { value: V3(1, .8, .5) }, uNight: { value: 0 }, uCover: { value: 0 },
    uCloudCol: { value: V3(1, 1, 1) }, uCloudDark: { value: V3(.5, .5, .55) }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) } };
  const m = new THREE.ShaderMaterial({ uniforms: uni, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww; }`,
    fragmentShader: `
      precision highp float; varying vec3 vDir;
      uniform vec3 uZen,uHor,uSun,uSunGlow,uCloudCol,uCloudDark; uniform float uNight,uCover,uTime; uniform vec2 uWind;
      float hs(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hs(i),hs(i+vec2(1,0)),f.x),mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+17.0; a*=0.5; } return s; }
      void main(){
        vec3 d=normalize(vDir); float y=d.y;
        vec3 col=mix(uHor,uZen,pow(clamp(y,0.0,1.0),0.55));
        if(y<0.0) col=uHor*(1.0+y*0.6);
        float sd=max(dot(d,uSun),0.0); float clr=1.0-uCover*0.9;
        col+=uSunGlow*(pow(sd,6.0)*0.22+pow(sd,900.0)*5.0)*clr;
        float md=max(dot(d,-uSun),0.0); col+=vec3(0.85,0.9,1.0)*smoothstep(0.9992,0.9997,md)*uNight*clr;
        if(uNight>0.02&&y>0.0){ vec3 sp=floor(d*220.0); float r=fract(sin(dot(sp,vec3(12.9,78.2,37.7)))*43758.5); col+=vec3(1.0)*step(0.9965,r)*uNight*clr*(0.5+0.5*r); }
        if(y>-0.02){ vec2 uv=d.xz/(max(y,0.0)+0.22)*1.3+uWind*uTime*0.015; float n=fbm(uv); float th=1.0-uCover*1.08;
          float c=smoothstep(th,th+0.22,n)*smoothstep(-0.02,0.12,y);
          float sh=fbm(uv+vec2(0.07,0.05)); vec3 cc=mix(uCloudCol,uCloudDark,clamp((n-sh)*3.0+0.35+uCover*0.35,0.0,1.0));
          col=mix(col,cc,c*0.92); }
        gl_FragColor=vec4(col,1.0);
      }` });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), m);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return { mesh, uni };
}

export function makePrecip(count = 5000) {
  const g = new THREE.BufferGeometry(); const seed = new Float32Array(count * 6), end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { const a = Math.random(), b = Math.random(), c = Math.random(); for (let k = 0; k < 2; k++) { seed.set([a, b, c], (i * 2 + k) * 3); end[i * 2 + k] = k; } }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uni = { uCam: { value: V3() }, uTime: { value: 0 }, uSpeed: { value: 28 }, uLen: { value: 1.3 }, uWind: { value: new THREE.Vector2(0, 0) }, uCol: { value: V3(.75, .8, .9) }, uAlpha: { value: .5 } };
  const m = new THREE.ShaderMaterial({ uniforms: uni, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute vec3 aSeed; attribute float aEnd; uniform vec3 uCam; uniform float uTime,uSpeed,uLen; uniform vec2 uWind;
      void main(){ vec3 box=vec3(70.0,34.0,70.0); vec3 s=aSeed*box;
        float y=mod(s.y-uTime*uSpeed,box.y);
        vec3 p; p.x=mod(s.x-uCam.x+box.x*0.5,box.x)-box.x*0.5; p.z=mod(s.z-uCam.z+box.z*0.5,box.z)-box.z*0.5; p.y=y-box.y*0.5;
        p+=vec3(uCam.x,uCam.y,uCam.z);
        vec3 vel=vec3(uWind.x,-uSpeed,uWind.y); p-=normalize(vel)*uLen*aEnd;
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0); }`,
    fragmentShader: `uniform vec3 uCol; uniform float uAlpha; void main(){ gl_FragColor=vec4(uCol,uAlpha); }` });
  const lines = new THREE.LineSegments(g, m); lines.frustumCulled = false; g.setDrawRange(0, 0);
  return { lines, uni, count };
}

// 太阳位置（本地标准时间 UTC+8，经度 lon）
export function sunPos(lat, lon, hours, doy) {
  const B = 2 * Math.PI * (doy - 81) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solar = hours + (lon - 120) / 15 + eot / 60;
  const dec = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI * (doy + 10) / 365), H = (solar - 12) * 15 * Math.PI / 180, phi = lat * Math.PI / 180;
  const se = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H), el = Math.asin(se);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;  // 从北顺时针
  return { el, az };
}

// 把 时间 + 天气 → 全部渲染参数
export function updateEnv(hours, doy, wx, sky, precip, scene, lat, lon) {
  const { el, az } = sunPos(lat, lon, hours, doy), s = Math.sin(el);
  const sun = V3(Math.sin(az) * Math.cos(el), s, -Math.cos(az) * Math.cos(el)).normalize();
  const day = sstep(-0.1, 0.22, s), tw = Math.exp(-Math.pow((s - 0.0) / 0.13, 2));
  const cc = clamp(wx.cloud / 100), rain = clamp(wx.rain / 3.5), fogw = wx.fog ? 1 : 0, snow = wx.snow ? clamp(0.4 + wx.snowAmt, 0, 1) : 0;
  const over = clamp(Math.max(sstep(0.15, 0.95, cc) * 0.9, rain, fogw * 0.9, snow * .8));
  let zen = mixv([.012, .02, .06], [.22, .46, .86], day), hor = mixv([.035, .05, .11], [.64, .79, .95], day);
  hor = mixv(hor, [1.0, .5, .27], tw * 0.75 * (1 - over * .6)); zen = mixv(zen, [.38, .38, .6], tw * .25 * (1 - over));
  const gray = mul(mixv([.03, .035, .05], [.67, .7, .74], day), 1 - rain * .3 - fogw * .05);
  zen = mixv(zen, gray, over * .88); hor = mixv(hor, mul(gray, 1.08), over * .8);
  if (fogw) hor = mixv(hor, mul(mixv([.05, .06, .09], [.78, .8, .82], day), 1), .7);
  const fogD = 0.00085 + 0.0011 * cc + 0.0032 * rain + fogw * 0.0095 + snow * 0.003;
  // 光
  const sunI = sstep(-0.02, 0.18, s), moonI = 1 - sstep(-0.14, -0.03, s);
  const warm = mixv([1.0, .66, .4], [1.0, .95, .86], sstep(0.02, 0.4, s));
  let lc = mul(warm, 0.95 * sunI * (1 - over * .78)); const mc = mul([.34, .42, .62], 0.42 * moonI * (1 - sunI) * (1 - over * .6));
  lc = [lc[0] + mc[0], lc[1] + mc[1], lc[2] + mc[2]];
  const ld = s > -0.07 ? sun : V3(-sun.x, -sun.y, -sun.z);
  const ambS = mixv(mul(mixv(zen, hor, .35), 0.78), [.09, .115, .2], (1 - day) * .8); ambS[0] += .12 * day + .05 * tw; ambS[1] += .12 * day + .035 * tw; ambS[2] += .1 * day + .03 * tw;
  const ambG = mixv(mul(ambS, .62), mul(hor, .4), .3);
  U.uSunDir.value.copy(ld); U.uSunCol.value.set(lc[0], lc[1], lc[2]); U.uAmbSky.value.set(...ambS); U.uAmbGnd.value.set(...ambG);
  U.uFogCol.value.set(hor[0], hor[1], hor[2]); U.uFogD.value = fogD; U.uNight.value = 1 - day; U.uWet.value = clamp(rain * 1.4);
  scene.fog.color.setRGB(hor[0], hor[1], hor[2]); scene.fog.density = fogD;
  ENV.sunElev = s; ENV.night = 1 - day; ENV.fogCol = hor; ENV.sunDir = sun; ENV.lightDir = ld; ENV.lightCol = lc; ENV.ambSky = ambS; ENV.ambGnd = ambG; ENV.cloud = cc; ENV.rain = rain; ENV.snow = snow; ENV.over = over;
  const u = sky.uni; u.uZen.value.set(...zen); u.uHor.value.set(...hor); u.uSun.value.copy(sun); u.uNight.value = 1 - day; u.uCover.value = clamp(cc * 0.95 + (fogw ? .5 : 0) + rain * .4 + snow * .5);
  u.uSunGlow.value.set(...mixv([1, .55, .25], [1, .93, .8], sstep(0.02, 0.45, s))).multiplyScalar(sunI);
  u.uCloudCol.value.set(...mixv([.06, .07, .11], mixv([1, .72, .55], [.98, .98, 1], sstep(0.0, 0.4, s)), day));
  u.uCloudDark.value.set(...mul(mixv([.03, .035, .06], [.5, .53, .6], day), 1 - rain * .3));
  const wr = wx.windDir * Math.PI / 180; ENV.wind = [-Math.sin(wr) * wx.wind, Math.cos(wr) * wx.wind]; u.uWind.value.set(ENV.wind[0], ENV.wind[1]);
  // 降水
  const pu = precip.uni, n = snow > 0 && rain < 0.02 ? Math.floor(precip.count * (0.35 + 0.65 * snow)) : Math.floor(precip.count * rain);
  precip.lines.geometry.setDrawRange(0, n * 2); precip.lines.visible = n > 0;
  const isSnow = snow > 0 && rain < 0.02;
  pu.uSpeed.value = isSnow ? 3.2 : 26 + rain * 8; pu.uLen.value = isSnow ? 0.3 : 1.1 + rain * 0.7; pu.uAlpha.value = isSnow ? 0.9 : 0.28 + 0.3 * rain;
  pu.uCol.value.set(...(isSnow ? [1, 1, 1] : mixv([.35, .4, .5], [.78, .82, .92], day)));
  pu.uWind.value.set(ENV.wind[0] * 0.6, ENV.wind[1] * 0.6);
  return { el, az };
}
