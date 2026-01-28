// Вспомогательные функции

export function uid() {
  return 't' + Math.random().toString(36).slice(2, 9);
}

export function roundRect(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const p = new Path2D();
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  p.closePath();
  return p;
}

export function handles(x, y, w, h) {
  return [
    { name: 'tl', x: x, y: y },
    { name: 'tr', x: x + w, y: y },
    { name: 'bl', x: x, y: y + h },
    { name: 'br', x: x + w, y: y + h }
  ];
}

export function wrap(ctx, text, maxW, T) {
  ctx.save();
  ctx.font = `${T.weight} ${T.size}px ${cssFont(T.family)}`;
  
  // Обрабатываем маркеры блюра [текст:степень] как единое целое
  // Временно заменяем их на плейсхолдеры для правильного переноса
  const blurMarkers = [];
  let processedText = String(text || '');
  // Регулярное выражение для поиска [текст:число]
  const blurRegex = /\[([^\]:]+):(\d+)\]/g;
  let match;
  let markerIndex = 0;
  
  // Заменяем маркеры блюра на плейсхолдеры
  while ((match = blurRegex.exec(processedText)) !== null) {
    const placeholder = `__BLUR_MARKER_${markerIndex}__`;
    blurMarkers.push({
      placeholder,
      original: match[0],
      innerText: match[1] // Только текст без степени
    });
    processedText = processedText.replace(match[0], placeholder);
    markerIndex++;
  }
  
  // Разбиваем на слова
  const words = processedText.split(/\s+/);
  const lines = [];
  let line = '';
  
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    // Восстанавливаем маркеры для измерения ширины
    let testForMeasure = test;
    for (const marker of blurMarkers) {
      // Для измерения используем только внутренний текст (без маркеров)
      testForMeasure = testForMeasure.replace(marker.placeholder, marker.innerText);
    }
    
    if (ctx.measureText(testForMeasure).width > maxW && line) {
      // Восстанавливаем маркеры перед добавлением строки
      let restoredLine = line;
      for (const marker of blurMarkers) {
        restoredLine = restoredLine.replace(marker.placeholder, marker.original);
      }
      lines.push(restoredLine);
      line = w;
    } else {
      line = test;
    }
  }
  
  if (line) {
    // Восстанавливаем маркеры в последней строке
    let restoredLine = line;
    for (const marker of blurMarkers) {
      restoredLine = restoredLine.replace(marker.placeholder, marker.original);
    }
    lines.push(restoredLine);
  }
  
  ctx.restore();
  return lines;
}

export function wrapCanvas(c, text, maxW, T) {
  c.save();
  c.font = `${T.weight} ${T.size}px ${cssFont(T.family)}`;
  
  // Обрабатываем маркеры блюра [текст:степень] как единое целое
  const blurMarkers = [];
  let processedText = String(text || '');
  const blurRegex = /\[([^\]:]+):(\d+)\]/g;
  let match;
  let markerIndex = 0;
  
  // Заменяем маркеры блюра на плейсхолдеры
  while ((match = blurRegex.exec(processedText)) !== null) {
    const placeholder = `__BLUR_MARKER_${markerIndex}__`;
    blurMarkers.push({
      placeholder,
      original: match[0],
      innerText: match[1]
    });
    processedText = processedText.replace(match[0], placeholder);
    markerIndex++;
  }
  
  // Разбиваем на слова
  const words = processedText.split(/\s+/);
  const lines = [];
  let line = '';
  
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    // Восстанавливаем маркеры для измерения ширины
    let testForMeasure = test;
    for (const marker of blurMarkers) {
      testForMeasure = testForMeasure.replace(marker.placeholder, marker.innerText);
    }
    
    if (c.measureText(testForMeasure).width > maxW && line) {
      // Восстанавливаем маркеры перед добавлением строки
      let restoredLine = line;
      for (const marker of blurMarkers) {
        restoredLine = restoredLine.replace(marker.placeholder, marker.original);
      }
      lines.push(restoredLine);
      line = w;
    } else {
      line = test;
    }
  }
  
  if (line) {
    // Восстанавливаем маркеры в последней строке
    let restoredLine = line;
    for (const marker of blurMarkers) {
      restoredLine = restoredLine.replace(marker.placeholder, marker.original);
    }
    lines.push(restoredLine);
  }
  
  c.restore();
  return lines;
}

export function cssFont(f) {
  return f.includes(' ') ? `"${f}"` : f;
}

export function toHex(c) {
  if (/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(c)) return c;
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return '#ffffff';
  return '#' + [m[1], m[2], m[3]].map(n => ('0' + (+n).toString(16)).slice(-2)).join('');
}

export function hexToRgb(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
  const n = parseInt(c, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInCubic(t) {
  return t * t * t;
}

export function download(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

