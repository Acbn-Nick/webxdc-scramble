// textures.js - Standalone Perlin noise + procedural texture generators

var PERLIN_SIZE = 4095;
var perlin;

function perlinInit() {
  if (perlin) return;
  perlin = new Float64Array(PERLIN_SIZE + 1);
  for (var i = 0; i < PERLIN_SIZE + 1; i++) {
    perlin[i] = Math.random();
  }
}

function scaledCosine(i) {
  return 0.5 * (1.0 - Math.cos(i * Math.PI));
}

function noise(x, y) {
  perlinInit();
  if (y === undefined) y = 0;

  if (x < 0) x = -x;
  if (y < 0) y = -y;

  var xi = Math.floor(x);
  var yi = Math.floor(y);
  var xf = x - xi;
  var yf = y - yi;
  var r = 0;
  var ampl = 0.5;

  for (var o = 0; o < 4; o++) {
    var of_ = xi + (yi << PERLIN_SIZE);
    var rxf = scaledCosine(xf);
    var ryf = scaledCosine(yf);

    var n1 = perlin[of_ & PERLIN_SIZE];
    n1 += rxf * (perlin[(of_ + 1) & PERLIN_SIZE] - n1);
    var n2 = perlin[(of_ + (1 << PERLIN_SIZE)) & PERLIN_SIZE];
    n2 += rxf * (perlin[(of_ + (1 << PERLIN_SIZE) + 1) & PERLIN_SIZE] - n2);
    n1 += ryf * (n2 - n1);

    r += n1 * ampl;
    ampl *= 0.5;
    xi <<= 1;
    xf *= 2;
    yi <<= 1;
    yf *= 2;

    if (xf >= 1.0) { xi++; xf--; }
    if (yf >= 1.0) { yi++; yf--; }
  }
  return r;
}

// -- Utilities --

function smoothstep(edge0, edge1, x) {
  var t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerpColor(c1, c2, t) {
  return [
    c1[0] + (c2[0] - c1[0]) * t,
    c1[1] + (c2[1] - c1[1]) * t,
    c1[2] + (c2[2] - c1[2]) * t
  ];
}

function clamp(v) {
  return Math.max(0, Math.min(255, v));
}

// -- Texture Generators --

function generatePageTexture() {
  var w = 300, h = 300;
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  var img = ctx.createImageData(w, h);
  var px = img.data;

  // Warm cream/linen paper
  var CREAM  = [245, 239, 230];
  var WARM   = [238, 228, 210];
  var LINEN  = [250, 244, 235];

  for (var x = 0; x < w; x++) {
    for (var y = 0; y < h; y++) {
      var n1 = noise(x * 0.008, y * 0.008);
      var n2 = noise(x * 0.02 + 200, y * 0.02 + 200);
      var n3 = noise(x * 0.004 + 500, y * 0.004 + 500);

      var base = n1 * 0.5 + n3 * 0.3;
      var c = lerpColor(CREAM, WARM, base);

      // Subtle linen grain
      var grain = smoothstep(0.4, 0.6, n2) * 0.15;
      c = lerpColor(c, LINEN, grain);

      var idx = (y * w + x) * 4;
      px[idx]     = clamp(c[0]);
      px[idx + 1] = clamp(c[1]);
      px[idx + 2] = clamp(c[2]);
      px[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function generateBoardTexture() {
  var w = 400, h = 400;
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  var img = ctx.createImageData(w, h);
  var px = img.data;

  // Green felt texture
  var DKGREEN = [27, 67, 50];
  var GREEN   = [45, 106, 79];
  var LTGREEN = [55, 120, 90];

  for (var x = 0; x < w; x++) {
    for (var y = 0; y < h; y++) {
      // Felt-like noise
      var n1 = noise(x * 0.006, y * 0.006);
      var n2 = noise(x * 0.015 + 100, y * 0.015 + 100);
      var n3 = noise(x * 0.003 + 300, y * 0.003 + 300);

      var flow = n1 * 0.5 + n3 * 0.5;
      var c = lerpColor(DKGREEN, GREEN, flow);

      // Lighter felt highlights
      var feltGrain = smoothstep(0.4, 0.7, n2) * smoothstep(0.0, 0.5, n3);
      c = lerpColor(c, LTGREEN, feltGrain * 0.25);

      var idx = (y * w + x) * 4;
      px[idx]     = clamp(c[0]);
      px[idx + 1] = clamp(c[1]);
      px[idx + 2] = clamp(c[2]);
      px[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function generateScoreBarTexture() {
  var w = 600, h = 40;
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  var img = ctx.createImageData(w, h);
  var px = img.data;

  // Warm wood grain
  var DKWOOD  = [120, 72, 30];
  var MDWOOD  = [160, 100, 50];
  var LTWOOD  = [188, 108, 37];
  var AMBER   = [200, 140, 70];

  for (var x = 0; x < w; x++) {
    for (var y = 0; y < h; y++) {
      // Horizontal brushed wood grain
      var n1 = noise(x * 0.003 + 77, y * 0.08);
      var n2 = noise(x * 0.006 + 177, y * 0.15 + 100);
      var n3 = noise(x * 0.001 + 377, y * 0.02 + 300);

      var flow = n1 * 0.5 + n3 * 0.5;
      var c = lerpColor(DKWOOD, MDWOOD, flow);

      // Amber warmth
      var amberWave = smoothstep(0.4, 0.7, n2) * smoothstep(0.0, 0.5, n3);
      c = lerpColor(c, AMBER, amberWave * 0.35);

      // Light wood highlights
      var lightMix = smoothstep(0.3, 0.5, n1) * 0.15;
      c = lerpColor(c, LTWOOD, lightMix);

      // Edge darkening
      var edgeY = Math.min(y, h - 1 - y) / Math.max(1, h * 0.3);
      edgeY = Math.min(1, edgeY);
      var darkFactor = 0.4 + 0.6 * edgeY;
      c[0] *= darkFactor; c[1] *= darkFactor; c[2] *= darkFactor;

      var idx = (y * w + x) * 4;
      px[idx]     = clamp(c[0]);
      px[idx + 1] = clamp(c[1]);
      px[idx + 2] = clamp(c[2]);
      px[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  // Inner bevel
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0.5, h - 0.5);
  ctx.lineTo(0.5, 0.5);
  ctx.lineTo(w - 0.5, 0.5);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.moveTo(w - 0.5, 0.5);
  ctx.lineTo(w - 0.5, h - 0.5);
  ctx.lineTo(0.5, h - 0.5);
  ctx.stroke();

  return canvas.toDataURL();
}

// -- Main entry point --

export function generateTextures() {
  var root = document.documentElement.style;
  root.setProperty('--texture-page', 'url(' + generatePageTexture() + ')');
  root.setProperty('--texture-board', 'url(' + generateBoardTexture() + ')');
  root.setProperty('--texture-scorebar', 'url(' + generateScoreBarTexture() + ')');
}
