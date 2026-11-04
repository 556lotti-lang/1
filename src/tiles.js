/* 牌の絵柄(SVG) — 萬子は漢数字＋萬、筒子は丸、索子は竹、字牌は漢字 */
(function (global) {
  'use strict';
  var C = global.MJCore;

  var INK = '#1d1b19';
  var RED = '#b4262c';
  var BLUE = '#1b5676';
  var GREEN = '#1c6b45';
  var W = 40, H = 55;

  var MAN = ['一', '二', '三', '四', '伍', '六', '七', '八', '九'];
  var HONOR = ['東', '南', '西', '北', '', '發', '中'];

  function dot(cx, cy, r, col) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.78) + '" fill="#fdfbf5" stroke="' + col
      + '" stroke-width="' + (r * 0.44) + '"/>'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.3) + '" fill="' + col + '"/>';
  }

  function stick(cx, cy, h, col, rot) {
    var w = 5.4, half = h / 2;
    var g = '<g transform="translate(' + cx + ' ' + cy + ')' + (rot ? ' rotate(' + rot + ')' : '') + '">';
    g += '<rect x="' + (-w / 2) + '" y="' + (-half) + '" width="' + w + '" height="' + h + '" rx="2.4" fill="' + col + '"/>';
    g += '<rect x="' + (-w / 2 - 1) + '" y="' + (-h / 6 - 0.8) + '" width="' + (w + 2) + '" height="1.7" rx="0.8" fill="' + col + '"/>';
    g += '<rect x="' + (-w / 2 - 1) + '" y="' + (h / 6 - 0.8) + '" width="' + (w + 2) + '" height="1.7" rx="0.8" fill="' + col + '"/>';
    g += '<rect x="-0.9" y="' + (-h / 6 + 1.4) + '" width="1.8" height="' + (h / 3 - 2.8) + '" rx="0.9" fill="#ffffff" opacity="0.38"/>';
    g += '</g>';
    return g;
  }

  /* ---- 筒子 ---- */
  function pinFace(n, red) {
    var b = BLUE, g = GREEN, r = RED;
    if (red) { b = r; g = r; }
    var s = '';
    if (n === 1) {
      s += '<circle cx="20" cy="27.5" r="13.5" fill="#fdfbf5" stroke="' + (red ? r : r) + '" stroke-width="3.2"/>';
      s += '<circle cx="20" cy="27.5" r="9" fill="#fdfbf5" stroke="' + b + '" stroke-width="2.6"/>';
      s += '<circle cx="20" cy="27.5" r="4.4" fill="' + r + '"/>';
      return s;
    }
    if (n === 2) { s += dot(20, 17, 8, g); s += dot(20, 38, 8, b); return s; }
    if (n === 3) { s += dot(11, 13, 7, b); s += dot(20, 27.5, 7, r); s += dot(29, 42, 7, g); return s; }
    if (n === 4) { s += dot(13, 17, 7.6, b); s += dot(27, 17, 7.6, b); s += dot(13, 38, 7.6, g); s += dot(27, 38, 7.6, g); return s; }
    if (n === 5) {
      s += dot(12, 15, 6.8, b); s += dot(28, 15, 6.8, b);
      s += dot(20, 27.5, 6.8, r);
      s += dot(12, 40, 6.8, g); s += dot(28, 40, 6.8, g); return s;
    }
    if (n === 6) {
      s += dot(13, 13, 6.6, g); s += dot(27, 13, 6.6, g);
      s += dot(13, 27.5, 6.6, r); s += dot(27, 27.5, 6.6, r);
      s += dot(13, 42, 6.6, r); s += dot(27, 42, 6.6, r); return s;
    }
    if (n === 7) {
      s += dot(11, 11, 5.6, g); s += dot(20, 16.5, 5.6, g); s += dot(29, 22, 5.6, g);
      s += dot(13, 34, 5.8, r); s += dot(27, 34, 5.8, r);
      s += dot(13, 45, 5.8, r); s += dot(27, 45, 5.8, r); return s;
    }
    if (n === 8) {
      var ys = [11, 22, 33, 44];
      for (var i = 0; i < 4; i++) { s += dot(13, ys[i], 5.6, b); s += dot(27, ys[i], 5.6, b); }
      return s;
    }
    var xs = [10, 20, 30], yy = [13, 27.5, 42], cols = [g, r, g];
    for (var y = 0; y < 3; y++) for (var x = 0; x < 3; x++) s += dot(xs[x], yy[y], 5.6, cols[y]);
    return s;
  }

  /* ---- 索子 ---- */
  function birdFace() {
    var s = '';
    // 枝
    s += '<path d="M12 46 Q20 42 29 45" stroke="' + GREEN + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
    // 尾
    s += '<path d="M24 36 Q33 32 34 22" stroke="' + GREEN + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    s += '<path d="M25 37 Q34 36 36 28" stroke="' + GREEN + '" stroke-width="2" fill="none" stroke-linecap="round"/>';
    // 胴
    s += '<ellipse cx="19" cy="31" rx="7.6" ry="9.4" fill="' + GREEN + '" transform="rotate(-18 19 31)"/>';
    // 翼
    s += '<path d="M16 26 Q22 30 19 38" stroke="#fdfbf5" stroke-width="1.6" fill="none" opacity=".7"/>';
    // 頭
    s += '<circle cx="15.5" cy="18.5" r="5" fill="' + GREEN + '"/>';
    // 冠羽
    s += '<path d="M14 13 L12 8 M16.5 13 L17 7.5" stroke="' + RED + '" stroke-width="1.6" stroke-linecap="round"/>';
    // くちばし・目
    s += '<path d="M11 19 L6 21.5 L11 22.5 Z" fill="' + RED + '"/>';
    s += '<circle cx="14.6" cy="17.6" r="1.25" fill="#fdfbf5"/>';
    // 脚
    s += '<path d="M19 40 L18 45 M22 39 L23 44" stroke="' + RED + '" stroke-width="1.5" stroke-linecap="round"/>';
    return s;
  }

  function souFace(n, red) {
    var g = red ? RED : GREEN, r = RED;
    if (n === 1) return birdFace();
    var s = '';
    if (n === 2) { s += stick(20, 16, 17, g); s += stick(20, 39, 17, g); return s; }
    if (n === 3) { s += stick(20, 14, 15, g); s += stick(13, 38, 15, g); s += stick(27, 38, 15, g); return s; }
    if (n === 4) { s += stick(13, 16, 16, g); s += stick(27, 16, 16, g); s += stick(13, 39, 16, g); s += stick(27, 39, 16, g); return s; }
    if (n === 5) {
      s += stick(12, 14, 13, g); s += stick(28, 14, 13, g);
      s += stick(20, 27.5, 13, red ? RED : r);
      s += stick(12, 41, 13, g); s += stick(28, 41, 13, g); return s;
    }
    if (n === 6) {
      [11, 20, 29].forEach(function (x) { s += stick(x, 16, 16, g); });
      [11, 20, 29].forEach(function (x) { s += stick(x, 39, 16, g); });
      return s;
    }
    if (n === 7) {
      s += stick(20, 12, 12, red ? RED : r);
      [11, 20, 29].forEach(function (x) { s += stick(x, 28, 12, g); });
      [11, 20, 29].forEach(function (x) { s += stick(x, 43, 12, g); });
      return s;
    }
    if (n === 8) {
      var top = [[11, -20], [17.5, 20], [24, -20], [30.5, 20]];
      var bot = [[11, 20], [17.5, -20], [24, 20], [30.5, -20]];
      top.forEach(function (p) { s += stick(p[0], 17, 15, g, p[1]); });
      bot.forEach(function (p) { s += stick(p[0], 39, 15, g, p[1]); });
      return s;
    }
    var xs = [11, 20, 29], ys = [13, 27.5, 42], cols = [red ? RED : r, g, g];
    for (var y = 0; y < 3; y++) for (var x = 0; x < 3; x++) s += stick(xs[x], ys[y], 12, cols[y]);
    return s;
  }

  /* ---- 萬子 ---- */
  function manFace(n, red) {
    var col = red ? '#d63a2f' : RED;
    var s = '';
    s += '<text x="20" y="24" text-anchor="middle" font-size="22" font-family="var(--font-display)" fill="'
      + (red ? '#e03127' : INK) + '" style="font-weight:600">' + MAN[n - 1] + '</text>';
    s += '<text x="20" y="48" text-anchor="middle" font-size="21" font-family="var(--font-display)" fill="'
      + col + '" style="font-weight:600">萬</text>';
    return s;
  }

  /* ---- 字牌 ---- */
  function honorFace(i) {
    if (i === 4) { // 白
      return '<rect x="8.5" y="10" width="23" height="35" rx="2" fill="none" stroke="#7d8ba0" stroke-width="1.6"/>'
        + '<rect x="11.5" y="13" width="17" height="29" rx="1.5" fill="none" stroke="#7d8ba0" stroke-width="0.9"/>';
    }
    var col = i === 5 ? GREEN : (i === 6 ? RED : INK);
    var size = i <= 3 ? 30 : 30;
    return '<text x="20" y="38" text-anchor="middle" font-size="' + size
      + '" font-family="var(--font-display)" fill="' + col + '" style="font-weight:600">' + HONOR[i] + '</text>';
  }

  var cache = {};
  function face(type, opt) {
    opt = opt || {};
    var key = type + (opt.red ? 'r' : '');
    if (cache[key]) return cache[key];
    var inner;
    if (type < 9) inner = manFace(type + 1, opt.red);
    else if (type < 18) inner = pinFace(type - 8, opt.red);
    else if (type < 27) inner = souFace(type - 17, opt.red);
    else inner = honorFace(type - 27);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + inner + '</svg>';
    cache[key] = svg;
    return svg;
  }

  global.MJTiles = { face: face, W: W, H: H };
})(typeof globalThis !== 'undefined' ? globalThis : this);
