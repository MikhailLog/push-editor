// Основной файл приложения
import { state, pushHistory, undo, serialize, deserialize, clampPush, readTpls, writeTpl, writeTplAsNew, deleteTpl, loadTemplate, loadTemplatesFromFiles, initTemplatesDir, getTemplatesDirHandle, setTemplatesDirHandle } from './state.js';
import {
  uid, roundRect, handles, wrap, wrapCanvas, cssFont, toHex, hexToRgb,
  easeOutCubic, easeInCubic, download
} from './utils.js';

const $ = s => document.querySelector(s);
let canvas, ctx, editor, ui;
let ffmpeg = null;
let ffmpegLoaded = false;

// Инициализация FFmpeg для MP4 экспорта
async function initFFmpeg() {
  if (ffmpegLoaded && ffmpeg) return;
  try {
    if (!window.loadFFmpeg) {
      console.warn('FFmpeg loader не найден');
      throw new Error('FFmpeg loader не найден');
    }
    
    const FFmpeg = await window.loadFFmpeg();
    if (!FFmpeg) {
      throw new Error('Не удалось загрузить класс FFmpeg');
    }
    
    // Локальная реализация toBlobURL (не зависит от CDN)
    const toBlobURL = async (url, mimeType) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      const blob = await response.blob();
      return URL.createObjectURL(new Blob([blob], { type: mimeType }));
    };
    
    ffmpeg = new FFmpeg();
    
    // Загружаем core и wasm файлы
    // Используем несколько вариантов URL для надежности
    // Локальный путь имеет приоритет (работает без HTTPS)
    const localBase = window.FFMPEG_CORE_PATH || './vendor/ffmpeg';
    const urls = [
      {
        base: localBase,
        name: 'local'
      },
      {
        base: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
        name: 'jsdelivr'
      },
      {
        base: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
        name: 'unpkg'
      }
    ];
    
    let loaded = false;
    let lastError = null;
    
    for (const urlConfig of urls) {
      try {
        const coreURL = await toBlobURL(`${urlConfig.base}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${urlConfig.base}/ffmpeg-core.wasm`, 'application/wasm');
        
        await ffmpeg.load({
          coreURL,
          wasmURL
        });
        
        ffmpegLoaded = true;
        loaded = true;
        console.log(`FFmpeg успешно загружен с ${urlConfig.name}`);
        break;
      } catch (e) {
        console.warn(`Ошибка загрузки FFmpeg с ${urlConfig.name}:`, e);
        lastError = e;
        continue;
      }
    }
    
    if (!loaded) {
      throw new Error(`Не удалось загрузить FFmpeg ни с одного CDN. Последняя ошибка: ${lastError?.message || 'неизвестная ошибка'}`);
    }
  } catch (e) {
    console.error('Критическая ошибка загрузки FFmpeg:', e);
    ffmpegLoaded = false;
    ffmpeg = null;
    throw e; // Пробрасываем ошибку дальше
  }
}

// Навигация по вкладкам
function initTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      $('#pane-' + t.dataset.pane).classList.add('active');
    });
  });
}

// Инициализация UI
function applyUI() {
  ui.customW.value = state.stage.w;
  ui.customH.value = state.stage.h;
  ui.bgColor.value = toHex(state.stage.bg);
  ui.bgAlpha.value = state.stage.bgAlpha;
  if (ui.bgAlphaValue) ui.bgAlphaValue.textContent = Math.round(state.stage.bgAlpha * 100) + '%';
  ui.previewScale.value = state.stage.previewScale;
  if (ui.previewScaleValue) ui.previewScaleValue.textContent = Math.round(state.stage.previewScale * 100) + '%';

  ui.imgShape.value = state.img.shape;
  ui.imgSize.value = state.img.size;
  ui.imgRadius.value = state.img.radius;
  const imgSizeVal = $('#imgSizeValue');
  if (imgSizeVal) imgSizeVal.textContent = Math.round(state.img.size) + 'px';
  const imgRadiusVal = $('#imgRadiusValue');
  if (imgRadiusVal) imgRadiusVal.textContent = Math.round(state.img.radius) + 'px';

  ui.pushColor.value = toHex(state.push.color);
  ui.pushOpacity.value = state.push.opacity;
  ui.pushRadius.value = state.push.r;
  ui.pushShadow.value = state.push.shadow;
  const pushOpacityVal = $('#pushOpacityValue');
  if (pushOpacityVal) pushOpacityVal.textContent = Math.round(state.push.opacity * 100) + '%';
  const pushRadiusVal = $('#pushRadiusValue');
  if (pushRadiusVal) pushRadiusVal.textContent = Math.round(state.push.r) + 'px';
  const pushShadowVal = $('#pushShadowValue');
  if (pushShadowVal) pushShadowVal.textContent = Math.round(state.push.shadow) + 'px';

  const current = currentText();
  ui.fontFamily.value = current?.family || 'Inter';
  ui.fontWeight.value = current?.weight || '400';
  ui.fontSize.value = current?.size || 42;
  ui.fontColor.value = current?.color || '#111111';
  ui.fontAlign.value = current?.align || 'left';
  ui.lineHeight.value = current?.line || 1.1;
  const lineHeightVal = $('#lineHeightValue');
  if (lineHeightVal) lineHeightVal.textContent = (current?.line || 1.1).toFixed(2);
  if (ui.blurIntensity) {
    ui.blurIntensity.value = current?.blurIntensity || 10;
    const blurIntensityVal = $('#blurIntensityValue');
    if (blurIntensityVal) blurIntensityVal.textContent = current?.blurIntensity || 10;
  }
  
  const pressDepthVal = $('#pressDepthValue');
  if (pressDepthVal) pressDepthVal.textContent = Math.round(state.anim.pressDepth * 100) + '%';

  // Инициализация значений анимации
  if (ui.aBeforeStart) ui.aBeforeStart.value = state.anim.beforeStart || 0;
  if (ui.aDelay) ui.aDelay.value = state.anim.delay || 0;
  if (ui.aIn) ui.aIn.value = state.anim.in || 0.6;
  if (ui.aInDirection) ui.aInDirection.value = state.anim.inDirection || 'top';
  if (ui.aHold) ui.aHold.value = state.anim.hold || 1.4;
  if (ui.aOut) ui.aOut.value = state.anim.out || 0.6;
  if (ui.aOutDirection) ui.aOutDirection.value = state.anim.outDirection || 'top';
  if (ui.aAfterEnd) ui.aAfterEnd.value = state.anim.afterEnd || 0;
  if (ui.pressEnabled) ui.pressEnabled.value = state.anim.pressOn ? 'on' : 'off';
  if (ui.pressAt) ui.pressAt.value = state.anim.pressAt || 1.0;
  if (ui.pressDur) ui.pressDur.value = state.anim.pressDur || 0.18;

  refreshTplGrid();
  updateCanvasCssSize();
}

function currentText() {
  return state.texts.find(t => t.id === state.selection.textId) || state.texts[0];
}

function setResolution(w, h) {
  pushHistory('res');
  resizeStage(w, h);
}

function setStyle(key, val) {
  const T = currentText();
  if (!T) return;
  pushHistory('style');
  T[key] = val;
  if (editor && editor.dataset.textId === T.id) applyEditorStyle(T);
}

// Настройка обработчиков событий
function setupEventListeners() {
  ui.preset.addEventListener('change', e => {
    const [w, h] = e.target.value.split('x').map(Number);
    setResolution(w, h);
  });

  ui.customW.addEventListener('change', () => {
    setResolution(parseInt(ui.customW.value || 1080), state.stage.h);
  });

  ui.customH.addEventListener('change', () => {
    setResolution(state.stage.w, parseInt(ui.customH.value || 1920));
  });

  ui.bgColor.addEventListener('input', e => {
    state.stage.bg = e.target.value;
  });

  ui.bgAlpha.addEventListener('input', e => {
    state.stage.bgAlpha = parseFloat(e.target.value);
    if (ui.bgAlphaValue) ui.bgAlphaValue.textContent = Math.round(state.stage.bgAlpha * 100) + '%';
  });

  ui.previewScale.addEventListener('input', e => {
    state.stage.previewScale = parseFloat(e.target.value);
    if (ui.previewScaleValue) ui.previewScaleValue.textContent = Math.round(state.stage.previewScale * 100) + '%';
    updateCanvasCssSize();
    hideEditor();
  });

  ui.imgShape.addEventListener('change', e => {
    state.img.shape = e.target.value;
  });

  ui.imgSize.addEventListener('input', e => {
    state.img.size = parseFloat(e.target.value);
    const valEl = $('#imgSizeValue');
    if (valEl) valEl.textContent = Math.round(state.img.size) + 'px';
  });

  ui.imgRadius.addEventListener('input', e => {
    state.img.radius = parseFloat(e.target.value);
    const valEl = $('#imgRadiusValue');
    if (valEl) valEl.textContent = Math.round(state.img.radius) + 'px';
  });

  ui.pushColor.addEventListener('input', e => {
    state.push.color = e.target.value;
  });

  ui.pushOpacity.addEventListener('input', e => {
    state.push.opacity = parseFloat(e.target.value);
    const valEl = $('#pushOpacityValue');
    if (valEl) valEl.textContent = Math.round(state.push.opacity * 100) + '%';
  });

  ui.pushRadius.addEventListener('input', e => {
    state.push.r = parseFloat(e.target.value);
    const valEl = $('#pushRadiusValue');
    if (valEl) valEl.textContent = Math.round(state.push.r) + 'px';
  });

  ui.pushShadow.addEventListener('input', e => {
    state.push.shadow = parseFloat(e.target.value);
    const valEl = $('#pushShadowValue');
    if (valEl) valEl.textContent = Math.round(state.push.shadow) + 'px';
  });

  ui.fontFamily.addEventListener('change', e => setStyle('family', e.target.value));
  ui.fontWeight.addEventListener('change', e => setStyle('weight', e.target.value));
  ui.fontSize.addEventListener('input', e => setStyle('size', parseFloat(e.target.value)));
  ui.fontColor.addEventListener('input', e => setStyle('color', e.target.value));
  ui.fontAlign.addEventListener('change', e => setStyle('align', e.target.value));
  ui.lineHeight.addEventListener('input', e => {
    setStyle('line', parseFloat(e.target.value));
    const valEl = $('#lineHeightValue');
    if (valEl) valEl.textContent = e.target.value;
  });

  if (ui.blurIntensity) {
    ui.blurIntensity.addEventListener('input', e => {
      setStyle('blurIntensity', parseFloat(e.target.value));
      const valEl = $('#blurIntensityValue');
      if (valEl) valEl.textContent = e.target.value;
    });
  }

  ui.btnAddText.addEventListener('click', () => {
    pushHistory('addText');
    const t = {
      id: uid(),
      text: "Текст",
      x: state.push.padding + state.img.size + 16,
      y: state.push.padding,
      family: "Inter",
      weight: "600",
      size: 34,
      color: "#111111",
      align: "left",
      line: 1.1,
      blurIntensity: 10
    };
    state.texts.push(t);
    state.selection.textId = t.id;
    showEditorFor(t);
    applyUI();
  });

  ui.btnCenter.addEventListener('click', () => {
    const T = currentText();
    if (!T) return;
    pushHistory('center');
    T.align = 'center';
    const pad = state.push.padding;
    const contentW = state.push.w - pad * 2;
    T.x = Math.floor(contentW / 2);
    applyUI();
  });

  ui.aBeforeStart.addEventListener('input', e => state.anim.beforeStart = parseFloat(e.target.value));
  ui.aDelay.addEventListener('input', e => state.anim.delay = parseFloat(e.target.value));
  ui.aIn.addEventListener('input', e => state.anim.in = parseFloat(e.target.value));
  ui.aInDirection.addEventListener('change', e => state.anim.inDirection = e.target.value);
  ui.aHold.addEventListener('input', e => state.anim.hold = parseFloat(e.target.value));
  ui.aOut.addEventListener('input', e => state.anim.out = parseFloat(e.target.value));
  ui.aOutDirection.addEventListener('change', e => state.anim.outDirection = e.target.value);
  ui.aAfterEnd.addEventListener('input', e => state.anim.afterEnd = parseFloat(e.target.value));
  ui.pressEnabled.addEventListener('change', e => state.anim.pressOn = e.target.value === 'on');
  ui.pressAt.addEventListener('input', e => state.anim.pressAt = parseFloat(e.target.value));
  ui.pressDur.addEventListener('input', e => state.anim.pressDur = parseFloat(e.target.value));
  ui.pressDepth.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    state.anim.pressDepth = val / 100;
    const valEl = $('#pressDepthValue');
    if (valEl) valEl.textContent = val + '%';
  });

  ui.btnPreview.addEventListener('click', () => { startPreview(); });
  ui.btnStop.addEventListener('click', stopAll);

  ui.btnSaveTpl.addEventListener('click', async () => {
    pushHistory('saveTpl');
    const name = ui.tplName.value.trim() || 'template-' + Date.now();
    const data = serialize(true);
    const thumb = renderPushThumb();
    
    ui.btnSaveTpl.disabled = true;
    ui.btnSaveTpl.textContent = 'Сохранение...';
    
    try {
      const saved = await writeTpl(name, data, thumb);
      if (saved) {
        await refreshTplGrid();
        ui.tplName.value = name;
      }
    } catch (e) {
      console.error('Ошибка сохранения:', e);
      alert('Ошибка сохранения: ' + e.message);
    }
    
    ui.btnSaveTpl.disabled = false;
    ui.btnSaveTpl.textContent = 'Сохранить';
  });

  // Сохранить как новый шаблон
  ui.btnSaveAsNew.addEventListener('click', async () => {
    pushHistory('saveAsNew');
    let name = ui.tplName.value.trim();
    if (!name) {
      name = 'template-' + Date.now();
    } else {
      // Добавляем суффикс для уникальности
      name = name + '-copy';
    }
    const data = serialize(true);
    const thumb = renderPushThumb();
    
    ui.btnSaveAsNew.disabled = true;
    ui.btnSaveAsNew.textContent = 'Создание...';
    
    try {
      const saved = await writeTplAsNew(name, data, thumb);
      if (saved) {
        await refreshTplGrid();
        ui.tplName.value = name;
      }
    } catch (e) {
      console.error('Ошибка создания:', e);
      alert('Ошибка создания: ' + e.message);
    }
    
    ui.btnSaveAsNew.disabled = false;
    ui.btnSaveAsNew.textContent = 'Как новый';
  });

  ui.btnExportTpl.addEventListener('click', () => {
    const name = ui.tplName.value.trim() || 'template';
    const payload = { data: serialize(true), created: Date.now() };
    download(JSON.stringify(payload, null, 2), name + '.json', 'application/json');
  });

  ui.btnImportTpl.addEventListener('click', () => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = '.json,application/json';
    el.onchange = ev => {
      const f = ev.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const obj = JSON.parse(fr.result);
          const data = obj.data || obj;
          deserialize(data, true);
          clampPush();
          hideEditor();
          applyUI();
        } catch (e) {
          alert('Ошибка импорта');
        }
      };
      fr.readAsText(f);
    };
    el.click();
  });

  ui.hiddenImgInput.addEventListener('change', onImageFile);
  ui.btnRecord.addEventListener('click', recordVideo);

  // Canvas события
  canvas.addEventListener('dblclick', e => {
    const pos = eventToScene(e);
    const local = sceneToLocal(pos.x, pos.y);
    const inside = local.x >= 0 && local.y >= 0 && local.x <= state.push.w && local.y <= state.push.h;
    if (!inside) return;

    const pad = state.push.padding;
    
    // СНАЧАЛА проверяем, не попал ли клик в существующий текст
    for (let i = state.texts.length - 1; i >= 0; i--) {
      const T = state.texts[i];
      const bb = textBBox(T);
      const textX = pad + bb.x;
      const textY = pad + bb.y;
      if (local.x >= textX && local.x <= textX + bb.w && local.y >= textY && local.y <= textY + bb.h) {
        state.selection.textId = T.id;
        showEditorFor(T);
        return;
      }
    }

    // Проверяем аватар
    const contentH = state.push.h - pad * 2;
    const imgS = state.img.size;
    const ix = pad + state.img.offX;
    const iy = pad + state.img.offY + (contentH - imgS) / 2;
    if (local.x >= ix && local.x <= ix + imgS && local.y >= iy && local.y <= iy + imgS) {
      ui.hiddenImgInput.click();
      return;
    }
    
    // Только если не попали ни в текст, ни в аватар - создаем новый текст
    pushHistory('addText');
    const t = {
      id: uid(),
      text: "Текст",
      x: Math.max(0, local.x - pad),
      y: Math.max(0, local.y - pad),
      family: "Inter",
      weight: "600",
      size: 34,
      color: "#111111",
      align: "left",
      line: 1.1,
      blurIntensity: 10
    };
    state.texts.push(t);
    state.selection.textId = t.id;
    showEditorFor(t);
    applyUI();
  });

  canvas.addEventListener('mousedown', e => {
    clearTimeout(clickTimer);
    hideEditor();
    const pos = eventToScene(e);
    const local = sceneToLocal(pos.x, pos.y);
    const P = state.push;

    // ручки плашки
    const hs = handles(0, 0, P.w, P.h);
    const hhit = hs.find(h => Math.abs(local.x - h.x) <= 8 && Math.abs(local.y - h.y) <= 8);
    if (hhit) {
      pushHistory('resizePush');
      state.selection = {
        target: 'push',
        mode: 'resize-' + hhit.name,
        start: local,
        orig: { ...P },
        shift: e.shiftKey
      };
      return;
    }

    // текст сверху вниз
    for (let i = state.texts.length - 1; i >= 0; i--) {
      const T = state.texts[i];
      const bb = textBBox(T);
      const pad = state.push.padding;
      const textX = pad + bb.x;
      const textY = pad + bb.y;
      if (local.x >= textX && local.x <= textX + bb.w && local.y >= textY && local.y <= textY + bb.h) {
        pushHistory('dragText');
        state.selection = {
          target: 'text',
          textId: T.id,
          mode: 'drag',
          start: local,
          orig: { x: T.x, y: T.y }
        };
        state.selection.textId = T.id;
        singleClickOpenEditor(T, e);
        return;
      }
    }

    // аватар
    const pad = P.padding;
    const contentH = P.h - pad * 2;
    const imgS = state.img.size;
    const ix = pad + state.img.offX;
    const iy = pad + state.img.offY + (contentH - imgS) / 2;
    if (local.x >= ix && local.x <= ix + imgS && local.y >= iy && local.y <= iy + imgS) {
      pushHistory('dragAvatar');
      state.selection = {
        target: 'image',
        textId: null,
        mode: 'drag',
        start: local,
        orig: { offX: state.img.offX, offY: state.img.offY }
      };
      return;
    }

    // плашка - перемещение
    if (local.x >= 0 && local.y >= 0 && local.x <= P.w && local.y <= P.h) {
      pushHistory('movePush');
      state.selection = {
        target: 'push',
        mode: 'move',
        start: { x: pos.x, y: pos.y },
        orig: { x: P.x, y: P.y }
      };
      return;
    }

    state.selection = { target: null, mode: null };
  });

  // Window события
  window.addEventListener('mousemove', e => {
    const sel = state.selection;
    if (!sel || !sel.mode) return;
    const pos = eventToScene(e);
    
    if (sel.mode === 'move' && sel.target === 'push') {
      const dx = pos.x - sel.start.x;
      const dy = pos.y - sel.start.y;
      state.push.x = sel.orig.x + dx;
      state.push.y = sel.orig.y + dy;
      
      // Магнитное выравнивание по центру
      const P = state.push;
      const W = state.stage.w;
      const H = state.stage.h;
      const pushCenterX = P.x + P.w / 2;
      const pushCenterY = P.y + P.h / 2;
      const stageCenterX = W / 2;
      const stageCenterY = H / 2;
      const snapThreshold = 30; // порог "магнитного" притяжения в пикселях
      
      // Проверяем горизонтальное выравнивание
      if (Math.abs(pushCenterX - stageCenterX) < snapThreshold) {
        state.push.x = stageCenterX - P.w / 2;
      }
      
      // Проверяем вертикальное выравнивание
      if (Math.abs(pushCenterY - stageCenterY) < snapThreshold) {
        state.push.y = stageCenterY - P.h / 2;
      }
      
      clampPush();
      hideEditor();
    } else if (sel.mode.startsWith('resize-')) {
      const local = sceneToLocal(pos.x, pos.y);
      let { x, y, w, h } = sel.orig;
      let dx = local.x - sel.start.x;
      let dy = local.y - sel.start.y;
      switch (sel.mode.split('-')[1]) {
        case 'tl': x += dx; y += dy; w -= dx; h -= dy; break;
        case 'tr': y += dy; w += dx; h -= dy; break;
        case 'bl': x += dx; w -= dx; h += dy; break;
        case 'br': w += dx; h += dy; break;
      }
      if (sel.shift) {
        const s = Math.sign(w) * Math.min(Math.abs(w), Math.abs(h));
        w = s;
        h = Math.sign(h) >= 0 ? Math.abs(s) : -Math.abs(s);
      }
      state.push.x = state.push.x + (x - sel.orig.x);
      state.push.y = state.push.y + (y - sel.orig.y);
      state.push.w = Math.max(200, w);
      state.push.h = Math.max(120, h);
      clampPush();
      hideEditor();
    } else if (sel.target === 'image' && sel.mode === 'drag') {
      const local = sceneToLocal(pos.x, pos.y);
      const dx = local.x - sel.start.x;
      const dy = local.y - sel.start.y;
      state.img.offX = sel.orig.offX + dx;
      state.img.offY = sel.orig.offY + dy;
      hideEditor();
    } else if (sel.target === 'text' && sel.mode === 'drag') {
      const local = sceneToLocal(pos.x, pos.y);
      const dx = local.x - sel.start.x;
      const dy = local.y - sel.start.y;
      const T = state.texts.find(x => x.id === sel.textId);
      if (T) {
        let newX = sel.orig.x + dx;
        let newY = sel.orig.y + dy;
        
        // Магнитное выравнивание
        const snapThreshold = 8;
        const TBB = textBBox(T);
        
        for (const other of state.texts) {
          if (other.id === T.id) continue;
          const otherBB = textBBox(other);
          
          if (Math.abs(newX - other.x) < snapThreshold) {
            newX = other.x;
          }
          if (Math.abs(newY - other.y) < snapThreshold) {
            newY = other.y;
          }
          if (Math.abs(newX - (other.x + otherBB.w)) < snapThreshold) {
            newX = other.x + otherBB.w;
          }
          if (Math.abs(newY - (other.y + otherBB.h)) < snapThreshold) {
            newY = other.y + otherBB.h;
          }
          if (Math.abs((newX + TBB.w) - other.x) < snapThreshold) {
            newX = other.x - TBB.w;
          }
          if (Math.abs((newY + TBB.h) - other.y) < snapThreshold) {
            newY = other.y - TBB.h;
          }
        }
        
        const pad = state.push.padding;
        const contentW = state.push.w - pad * 2;
        const contentH = state.push.h - pad * 2;
        T.x = Math.max(0, Math.min(newX, contentW - TBB.w));
        T.y = Math.max(0, Math.min(newY, contentH - TBB.h));
      }
      hideEditor();
    }
  });

  window.addEventListener('mouseup', () => {
    if (state.selection) {
      state.selection.mode = null;
    }
  });

  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo(deserialize, applyUI, hideEditor);
      return;
    }
    if (e.key === 'Delete' && editor && editor.style.display !== 'block') {
      if (state.selection.textId) {
        const id = state.selection.textId;
        pushHistory('delText');
        const idx = state.texts.findIndex(t => t.id === id);
        if (idx >= 0) {
          state.texts.splice(idx, 1);
          state.selection.textId = state.texts[state.texts.length - 1]?.id || null;
        }
      } else if (state.selection.target === 'image' && state.img.image) {
        pushHistory('delImage');
        if (state.img.src && state.img.src.startsWith('blob:')) {
          URL.revokeObjectURL(state.img.src);
        }
        state.img.image = null;
        state.img.src = null;
        state.img.dataURL = null;
        state.selection.target = null;
        state.selection.textId = null;
      }
    }
  });

  // Editor события
  editor.addEventListener('blur', () => {
    commitEditor(false); // При blur сохраняем с историей
    historyPushedForEdit = false;
    lastCommittedText = '';
  });
  // Сохраняем текст при каждом изменении (в реальном времени, без истории)
  editor.addEventListener('input', () => {
    commitEditor(true); // При input сохраняем без добавления в историю
  });
  editor.addEventListener('keydown', e => {
    // Ctrl+Enter или Cmd+Enter - сохранить и закрыть
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitEditor(false);
      historyPushedForEdit = false;
      lastCommittedText = '';
      hideEditor();
    }
    // Escape - отменить и закрыть
    if (e.key === 'Escape') {
      e.preventDefault();
      // Восстанавливаем исходный текст при отмене
      const id = editor.dataset.textId;
      const T = state.texts.find(x => x.id === id);
      if (T) {
        editor.value = lastCommittedText || T.text;
      }
      historyPushedForEdit = false;
      lastCommittedText = '';
      hideEditor();
    }
    // Обычный Enter теперь создает новую строку (для textarea это работает автоматически)
  });
}

async function refreshTplGrid() {
  const grid = ui.tplGrid;
  grid.innerHTML = '';
  
  // Кнопка обновления списка
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn';
  refreshBtn.textContent = 'Обновить список';
  refreshBtn.style.cssText = 'margin-right:8px;';
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Загрузка...';
    await refreshTplGrid();
  });
  
  // Кнопка загрузки из папки (fallback)
  const loadBtn = document.createElement('button');
  loadBtn.className = 'btn';
  loadBtn.textContent = 'Импорт из папки';
  loadBtn.title = 'Загрузить локальные шаблоны из папки';
  loadBtn.addEventListener('click', async () => {
    loadBtn.disabled = true;
    await loadTemplatesFromFiles();
    await refreshTplGrid();
    loadBtn.disabled = false;
  });
  
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'grid-column:1/-1; margin-bottom:10px; display:flex; gap:8px;';
  btnRow.appendChild(refreshBtn);
  btnRow.appendChild(loadBtn);
  grid.appendChild(btnRow);
  
  const all = await readTpls();
  Object.entries(all).forEach(([name, obj]) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.style.position = 'relative';
    
    // Иконка сервера если шаблон на сервере
    if (obj.fromServer) {
      const serverIcon = document.createElement('span');
      serverIcon.innerHTML = '☁';
      serverIcon.title = 'Сохранён на сервере';
      serverIcon.style.cssText = 'position:absolute; top:4px; left:4px; font-size:14px; opacity:0.7;';
      div.appendChild(serverIcon);
    }
    
    // Крестик для удаления
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'thumb-delete';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = 'Удалить шаблон';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await showDeleteConfirm(name);
      if (confirmed) {
        await deleteTpl(name);
        await refreshTplGrid();
      }
    });
    div.appendChild(deleteBtn);
    
    const img = document.createElement('img');
    img.src = obj.thumb || renderPushThumb();
    const cap = document.createElement('div');
    cap.className = 'tname';
    cap.textContent = name;
    div.appendChild(img);
    div.appendChild(cap);
    
    // Загрузка шаблона при клике
    div.addEventListener('click', async () => {
      div.style.opacity = '0.5';
      try {
        const data = await loadTemplate(name);
        deserialize(data, true);
        clampPush();
        hideEditor();
        applyUI();
        // Устанавливаем имя шаблона в поле ввода
        if (ui.tplName) ui.tplName.value = name;
      } catch (e) {
        console.error('Ошибка загрузки шаблона:', e);
        alert('Ошибка загрузки шаблона: ' + e.message);
      }
      div.style.opacity = '1';
    });
    grid.appendChild(div);
  });
  
  if (Object.keys(all).length === 0) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.style.cssText = 'grid-column:1/-1; text-align:center; padding:20px;';
    hint.textContent = 'Шаблоны не найдены. Создайте первый шаблон!';
    grid.appendChild(hint);
  }
}

// Модальное окно подтверждения удаления
function showDeleteConfirm(templateName) {
  return new Promise((resolve) => {
    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.style.cssText = `
      background: var(--card-bg, #1a1d24);
      border: 1px solid var(--border-color, #2a2d35);
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    `;
    
    const title = document.createElement('div');
    title.textContent = 'Удалить шаблон';
    title.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--text-primary, #e0e0e0);
    `;
    
    const message = document.createElement('div');
    message.textContent = `Вы уверены, что хотите удалить шаблон "${templateName}"?`;
    message.style.cssText = `
      font-size: 14px;
      color: var(--text-secondary, #a0a0a0);
      margin-bottom: 24px;
      line-height: 1.5;
    `;
    
    const buttons = document.createElement('div');
    buttons.style.cssText = `
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    `;
    
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn';
    btnCancel.textContent = 'Отмена';
    btnCancel.style.cssText = `
      background: var(--input-bg, #252830);
      color: var(--text-primary, #e0e0e0);
      border: 1px solid var(--border-color, #2a2d35);
    `;
    btnCancel.addEventListener('click', () => {
      document.body.removeChild(modal);
      resolve(false);
    });
    
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn';
    btnDelete.textContent = 'Да';
    btnDelete.style.cssText = `
      background: #e74c3c;
      color: white;
      border: 1px solid #c0392b;
    `;
    btnDelete.addEventListener('click', () => {
      document.body.removeChild(modal);
      resolve(true);
    });
    
    buttons.appendChild(btnCancel);
    buttons.appendChild(btnDelete);
    
    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(buttons);
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    // Закрытие по клику на overlay
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
        resolve(false);
      }
    });
  });
}

// Канвас размер и масштаб
function resizeStage(w, h) {
  canvas.width = w;
  canvas.height = h;
  state.stage.w = w;
  state.stage.h = h;
  updateCanvasCssSize();
  clampPush();
}

function updateCanvasCssSize() {
  const s = state.stage.previewScale;
  canvas.style.width = Math.round(canvas.width * s) + 'px';
  canvas.style.height = Math.round(canvas.height * s) + 'px';
}

// Преобразование координат
function cssScale() {
  const rect = canvas.getBoundingClientRect();
  return rect.width / canvas.width;
}

function eventToScene(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function sceneToLocal(px, py) {
  const P = state.push;
  const at = animTransform();
  const centerX = P.x + P.w / 2 + at.offsetX;
  const centerY = P.y + P.h / 2 + at.offsetY;
  const s = at.scale;
  const lx = (px - centerX) / s + P.w / 2;
  const ly = (py - centerY) / s + P.h / 2;
  return { x: lx, y: ly };
}

function localToScene(lx, ly, useAnimation = true) {
  const P = state.push;
  const at = useAnimation ? animTransform() : { offsetX: 0, offsetY: 0, scale: 1, shadowK: 1 };
  const centerX = P.x + P.w / 2 + at.offsetX;
  const centerY = P.y + P.h / 2 + at.offsetY;
  const s = at.scale;
  const sx = (lx - P.w / 2) * s + centerX;
  const sy = (ly - P.h / 2) * s + centerY;
  return { x: sx, y: sy };
}

// Рисование
function draw() {
  const W = state.stage.w;
  const H = state.stage.h;
  ctx.clearRect(0, 0, W, H);
  
  // фон
  const bg = hexToRgb(state.stage.bg);
  ctx.fillStyle = `rgba(${bg.r},${bg.g},${bg.b},${state.stage.bgAlpha})`;
  ctx.fillRect(0, 0, W, H);

  const P = state.push;
  const at = animTransform();

  // Групповой трансформ
  ctx.save();
  const centerX = P.x + P.w / 2 + at.offsetX;
  const centerY = P.y + P.h / 2 + at.offsetY;
  ctx.translate(centerX, centerY);
  ctx.scale(at.scale, at.scale);
  ctx.translate(-P.w / 2, -P.h / 2);

  // Тень и корпус
  ctx.save();
  ctx.globalAlpha = P.opacity;
  ctx.shadowColor = 'rgba(0,0,0,' + (0.35 * at.shadowK) + ')';
  ctx.shadowBlur = P.shadow * at.shadowK;
  ctx.shadowOffsetY = 2 * at.shadowK;
  ctx.fillStyle = P.color;
  ctx.fill(roundRect(0, 0, P.w, P.h, P.r));
  ctx.restore();

  // Контентная область
  const pad = P.padding;
  const contentX = pad;
  const contentY = pad;
  const contentW = P.w - pad * 2;
  const contentH = P.h - pad * 2;

  // Аватар
  const imgS = state.img.size;
  const imgX = contentX + state.img.offX;
  const imgY = contentY + state.img.offY + (contentH - imgS) / 2;

  if (state.img.image) {
    ctx.save();
    if (state.img.shape === 'circle') {
      const r = imgS / 2;
      ctx.beginPath();
      ctx.arc(imgX + r, imgY + r, r, 0, Math.PI * 2);
      ctx.clip();
    } else if (state.img.shape === 'rounded') {
      ctx.clip(roundRect(imgX, imgY, imgS, imgS, state.img.radius));
    }
    ctx.drawImage(state.img.image, imgX, imgY, imgS, imgS);
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#000';
    ctx.fillRect(imgX, imgY, imgS, imgS);
    ctx.restore();
  }

  // Тексты
  for (const T of state.texts) {
    if (editor.style.display === 'block' && editor.dataset.textId === T.id) continue;
    drawText(T, contentX, contentY, contentW);
  }

  // Вспомогательные контуры
  if (!state.runtime.recording && !state.runtime.preview) {
    drawOverlays();
  }

  ctx.restore();
  
  // Рисуем линии центра сцены (после трансформации плашки, в координатах сцены)
  if (!state.runtime.recording && !state.runtime.preview) {
    drawCenterGuides();
  }
}

function drawCenterGuides() {
  const P = state.push;
  const W = state.stage.w;
  const H = state.stage.h;
  
  // Проверяем, близка ли плашка к центру (для визуальной индикации)
  const pushCenterX = P.x + P.w / 2;
  const pushCenterY = P.y + P.h / 2;
  const stageCenterX = W / 2;
  const stageCenterY = H / 2;
  const snapThreshold = 30;
  const isNearCenterX = Math.abs(pushCenterX - stageCenterX) < snapThreshold;
  const isNearCenterY = Math.abs(pushCenterY - stageCenterY) < snapThreshold;
  
  // Рисуем линии центра, если плашка близка к центру
  if (isNearCenterX || isNearCenterY) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 100, 0, 0.6)'; // оранжевый цвет для линий центра
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    
    if (isNearCenterX) {
      // Вертикальная линия через центр
      ctx.beginPath();
      ctx.moveTo(stageCenterX, 0);
      ctx.lineTo(stageCenterX, H);
      ctx.stroke();
    }
    
    if (isNearCenterY) {
      // Горизонтальная линия через центр
      ctx.beginPath();
      ctx.moveTo(0, stageCenterY);
      ctx.lineTo(W, stageCenterY);
      ctx.stroke();
    }
    
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawOverlays() {
  const P = state.push;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,150,255,0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.stroke(roundRect(0, 0, P.w, P.h, Math.max(0, P.r - 1)));
  ctx.setLineDash([]);
  const hs = handles(0, 0, P.w, P.h);
  ctx.fillStyle = '#0ef';
  hs.forEach(h => ctx.fillRect(h.x - 4, h.y - 4, 8, 8));

  const pad = P.padding;
  const contentH = P.h - pad * 2;
  const imgS = state.img.size;
  const ix = pad + state.img.offX;
  const iy = pad + state.img.offY + (contentH - imgS) / 2;
  ctx.strokeStyle = 'rgba(255,200,0,0.9)';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(ix - 1, iy - 1, imgS + 2, imgS + 2);
  ctx.setLineDash([]);

  const T = currentText();
  if (T) {
    const bb = textBBox(T);
    ctx.strokeStyle = 'rgba(0,255,180,0.9)';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawText(T, contentX, contentY, contentW) {
  ctx.save();
  // contentX = pad, contentY = pad
  // x = pad + T.x - это координата в локальной системе плашки (где 0,0 - левый верхний угол плашки)
  const x = contentX + T.x;
  const y = contentY + T.y;
  ctx.font = `${T.weight} ${T.size}px ${cssFont(T.family)}`;
  ctx.fillStyle = T.color;
  ctx.textAlign = T.align;
  ctx.textBaseline = 'top';
  const maxW = Math.max(1, contentW - T.x);
  
  // Разбиваем текст на строки (учитываем переносы строк из редактора)
  const textLines = T.text.split('\n');
  const allLines = [];
  
  // Для каждой строки применяем перенос по ширине
  for (const textLine of textLines) {
    if (textLine.trim() === '') {
      // Пустая строка - добавляем как есть
      allLines.push('');
    } else {
      // Применяем wrap для каждой строки
      const wrapped = wrap(ctx, textLine, maxW, T);
      allLines.push(...wrapped);
    }
  }
  
  const step = T.size * T.line;
  let dx = x;
  if (T.align === 'center') dx = x + maxW / 2;
  if (T.align === 'right') dx = x + maxW;
  let yy = y;
  
  // Базовая интенсивность блюра (используется как значение по умолчанию, если не указана в маркере)
  const defaultBlurIntensity = T.blurIntensity || 0;
  
  for (const ln of allLines) {
    if (ln.length === 0) {
      yy += step;
      continue;
    }
    
    // Рисуем текст с поддержкой множественных блюров через синтаксис [текст:степень]
    drawTextWithMultipleBlurs(ctx, ln, defaultBlurIntensity, dx, yy, T.align);
    yy += step;
  }
  ctx.restore();
}

// Функция для рисования текста с поддержкой множественных блюров через синтаксис [текст:степень]
function drawTextWithMultipleBlurs(ctx, text, defaultBlurIntensity, x, y, align) {
  ctx.save();
  
  // Парсим текст и находим все блоки с блюром [текст:степень]
  const parts = parseTextWithBlur(text);
  
  let currentX = x;
  
  // Если выравнивание не left, нужно вычислить начальную позицию
  if (align === 'center' || align === 'right') {
    // Вычисляем общую ширину текста (без учета маркеров блюра)
    let totalWidth = 0;
    for (const part of parts) {
      totalWidth += ctx.measureText(part.text).width;
    }
    if (align === 'center') {
      currentX = x - totalWidth / 2;
    } else if (align === 'right') {
      currentX = x - totalWidth;
    }
  }
  
  // Рисуем каждую часть текста
  for (const part of parts) {
    if (part.blur && part.blurIntensity > 0) {
      // Рисуем текст с блюром указанной интенсивности
      ctx.save();
      if (ctx.filter !== undefined) {
        ctx.filter = `blur(${part.blurIntensity}px)`;
        ctx.fillText(part.text, currentX, y);
      } else {
        // Fallback: рисуем несколько раз со смещением для эффекта блюра
        const blurSteps = Math.max(3, Math.floor(part.blurIntensity / 2));
        for (let j = 0; j < blurSteps; j++) {
          const offset = (Math.random() - 0.5) * part.blurIntensity;
          ctx.globalAlpha = 0.3;
          ctx.fillText(part.text, currentX + offset, y + offset);
        }
        ctx.globalAlpha = 1;
        ctx.fillText(part.text, currentX, y);
      }
      ctx.restore();
    } else {
      // Обычный текст без блюра
      ctx.fillText(part.text, currentX, y);
    }
    
    // Перемещаем позицию для следующей части
    const partWidth = ctx.measureText(part.text).width;
    currentX += partWidth;
  }
  
  ctx.restore();
}

// Функция для парсинга текста с маркерами блюра [текст:степень]
function parseTextWithBlur(text) {
  const parts = [];
  let currentIndex = 0;
  
  // Регулярное выражение для поиска [текст:число], где число от 1 до 100
  // Формат: [текст:степень], например [lute:10] или [слово:50]
  const blurRegex = /\[([^\]:]+):(\d+)\]/g;
  let match;
  
  while ((match = blurRegex.exec(text)) !== null) {
    // Добавляем текст до маркера блюра
    if (match.index > currentIndex) {
      const beforeText = text.substring(currentIndex, match.index);
      if (beforeText) {
        parts.push({ text: beforeText, blur: false });
      }
    }
    
    // Извлекаем текст и степень блюра
    const blurredText = match[1];
    const blurIntensity = parseInt(match[2], 10);
    
    // Ограничиваем степень блюра от 1 до 100
    const clampedIntensity = Math.max(1, Math.min(100, blurIntensity));
    
    if (blurredText) {
      parts.push({ 
        text: blurredText, 
        blur: true, 
        blurIntensity: clampedIntensity 
      });
    }
    
    currentIndex = match.index + match[0].length;
  }
  
  // Добавляем оставшийся текст после последнего маркера
  if (currentIndex < text.length) {
    const remainingText = text.substring(currentIndex);
    if (remainingText) {
      parts.push({ text: remainingText, blur: false });
    }
  }
  
  // Если не было найдено маркеров блюра, возвращаем весь текст как обычный
  if (parts.length === 0) {
    parts.push({ text: text, blur: false });
  }
  
  return parts;
}

function textBBox(T) {
  const pad = state.push.padding;
  const contentW = state.push.w - pad * 2;
  const maxW = Math.max(1, contentW - T.x);
  ctx.save();
  ctx.font = `${T.weight} ${T.size}px ${cssFont(T.family)}`;
  
  // Разбиваем текст на строки (учитываем переносы строк)
  const textLines = T.text.split('\n');
  const allLines = [];
  
  for (const textLine of textLines) {
    if (textLine.trim() === '') {
      allLines.push('');
    } else {
      const wrapped = wrap(ctx, textLine, maxW, T);
      allLines.push(...wrapped);
    }
  }
  
  const h = Math.max(1, allLines.length * T.size * T.line);
  let w = 1;
  for (const ln of allLines) {
    // Убираем маркеры блюра [текст:степень] для расчета ширины
    const textWithoutMarkers = ln.replace(/\[([^\]:]+):(\d+)\]/g, (match, textPart) => {
      // Извлекаем текст внутри маркера (без самого маркера и степени)
      return textPart || '';
    });
    w = Math.max(w, ctx.measureText(textWithoutMarkers).width);
  }
  ctx.restore();
  return { x: T.x, y: T.y, w, h };
}

// Анимация
function animTransform() {
  if (!state.runtime.playing) return { offsetX: 0, offsetY: 0, scale: 1, shadowK: 1 };
  const A = state.anim;
  const P = state.push;
  const W = state.stage.w;
  const H = state.stage.h;
  const t = (performance.now() - state.runtime.t0) / 1000;
  
  // Вычисляем смещения для разных направлений
  function getOffsetForDirection(direction, progress) {
    // progress: 0 = вне экрана, 1 = на месте
    let offsetX = 0;
    let offsetY = 0;
    
    switch (direction) {
      case 'top':
        offsetY = -(P.y + P.h + 40) * (1 - progress);
        break;
      case 'bottom':
        offsetY = (H - P.y + 40) * (1 - progress);
        break;
      case 'left':
        offsetX = -(P.x + P.w + 40) * (1 - progress);
        break;
      case 'right':
        offsetX = (W - P.x + 40) * (1 - progress);
        break;
    }
    
    return { offsetX, offsetY };
  }
  
  // Время до начала анимации (статичный кадр)
  if (t < A.beforeStart) {
    const off = getOffsetForDirection(A.inDirection, 0);
    return { offsetX: off.offsetX, offsetY: off.offsetY, scale: 1, shadowK: 1 };
  }
  
  // Смещаем время относительно beforeStart
  const animTime = t - A.beforeStart;
  const tInEnd = A.delay + A.in;
  const tHoldEnd = tInEnd + A.hold;
  const tOutEnd = tHoldEnd + A.out;
  const tTotal = tOutEnd + A.afterEnd;
  
  let offsetX = 0;
  let offsetY = 0;
  let scale = 1;
  let shadowK = 1;

  if (animTime < A.delay) {
    // ожидание после beforeStart - вне экрана
    const off = getOffsetForDirection(A.inDirection, 0);
    offsetX = off.offsetX;
    offsetY = off.offsetY;
  } else if (animTime <= tInEnd) {
    // появление
    const k = easeOutCubic((animTime - A.delay) / A.in);
    const off = getOffsetForDirection(A.inDirection, k);
    offsetX = off.offsetX;
    offsetY = off.offsetY;
  } else if (animTime <= tHoldEnd) {
    // пауза - на месте
    offsetX = 0;
    offsetY = 0;
  } else if (animTime <= tOutEnd) {
    // уход
    const k = easeInCubic((animTime - tHoldEnd) / A.out);
    const off = getOffsetForDirection(A.outDirection, 1 - k);
    offsetX = off.offsetX;
    offsetY = off.offsetY;
  } else if (animTime <= tTotal) {
    // после окончания (статичный кадр) - вне экрана
    const off = getOffsetForDirection(A.outDirection, 0);
    offsetX = off.offsetX;
    offsetY = off.offsetY;
  } else {
    // анимация закончилась
    if (state.runtime.preview) stopAll();
    const off = getOffsetForDirection(A.outDirection, 0);
    return { offsetX: off.offsetX, offsetY: off.offsetY, scale: 1, shadowK: 1 };
  }

  // Нажатие (относительно времени анимации, без beforeStart)
  if (A.pressOn) {
    const ps = A.beforeStart + A.delay + A.pressAt;
    const pe = ps + A.pressDur;
    if (t >= ps && t <= pe) {
      const mid = (ps + pe) / 2;
      const half = A.pressDur / 2;
      const k = 1 - Math.abs((t - mid) / half);
      scale = 1 - A.pressDepth * k;
      shadowK = 1 - 0.5 * k;
    }
  }
  
  return { offsetX, offsetY, scale, shadowK };
}

// Вспомогательные функции
let clickTimer = null;

function onImageFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  pushHistory('loadImg');
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    state.img.image = img;
    state.img.src = url;
    
    // Конвертируем изображение в base64 для сохранения в шаблонах
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      state.img.dataURL = canvas.toDataURL('image/png');
    } catch (err) {
      console.error('Ошибка конвертации изображения в base64:', err);
    }
  };
  img.src = url;
}

function singleClickOpenEditor(T, e) {
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    showEditorFor(T);
  }, 180);
}

// Inline редактор
function showEditorFor(T) {
  if (state.runtime.playing) {
    stopAll();
  }

  // 1. Берём реальный bounding-box текста в локальных координатах плашки
  const pad = state.push.padding;
  const bb = textBBox(T); // { x, y, w, h } в системе координат плашки (0..P.w, 0..P.h)

  // Переводим левый верхний угол bbox в локальные координаты сцены с учётом padding
  const localX = pad + bb.x;
  const localY = pad + bb.y;

  // 2. Переводим в координаты сцены БЕЗ анимации (плашка на месте)
  const sceneCoords = localToScene(localX, localY, false);

  // 3. Геометрия canvas и родителя (stageBox), внутри которого позиционируется editor
  const canvasRect = canvas.getBoundingClientRect();
  const parentRect = editor.parentElement.getBoundingClientRect();

  const scaleX = canvasRect.width / canvas.width;
  const scaleY = canvasRect.height / canvas.height;

  // 4. Учитываем внутренние отступы textarea
  const editorPaddingLeft = 4; // padding-left из CSS (.editor { padding: 2px 4px; })
  const editorPaddingTop = 2;  // padding-top из CSS
  const editorPadding = 8;     // суммарный горизонтальный/вертикальный запас

  // 5. Позиция редактора относительно родителя (stageBox)
  // canvasRect.left - parentRect.left = левый край canvas в системе координат родителя
  let editorLeft = (canvasRect.left - parentRect.left) + sceneCoords.x * scaleX - editorPaddingLeft;
  let editorTop  = (canvasRect.top  - parentRect.top)  + sceneCoords.y * scaleY - editorPaddingTop;

  // 6. Размер редактора по bbox текста
  const editorWidth  = Math.max(120, bb.w * scaleX + editorPadding);
  const editorHeight = Math.max(40,  bb.h * scaleY + editorPadding);

  // 7. Ограничиваем редактор границами canvas (в системе координат родителя)
  const canvasLeftInParent   = canvasRect.left - parentRect.left;
  const canvasTopInParent    = canvasRect.top  - parentRect.top;
  const canvasRightInParent  = canvasLeftInParent + canvasRect.width;
  const canvasBottomInParent = canvasTopInParent  + canvasRect.height;

  if (editorLeft + editorWidth > canvasRightInParent) {
    editorLeft = canvasRightInParent - editorWidth - 4;
  }
  if (editorTop + editorHeight > canvasBottomInParent) {
    editorTop = canvasBottomInParent - editorHeight - 4;
  }
  if (editorLeft < canvasLeftInParent) {
    editorLeft = canvasLeftInParent + 4;
  }
  if (editorTop < canvasTopInParent) {
    editorTop = canvasTopInParent + 4;
  }

  // 8. Устанавливаем позицию и содержимое редактора
  editor.style.left = editorLeft + 'px';
  editor.style.top = editorTop + 'px';
  editor.style.width = editorWidth + 'px';
  editor.style.height = editorHeight + 'px';
  editor.style.display = 'block';
  editor.dataset.textId = T.id;
  editor.value = T.text;
  lastCommittedText = T.text;
  historyPushedForEdit = false;

  // Применяем стили (цвет, шрифт и т.п.)
  applyEditorStyle(T);

  editor.focus();
  editor.setSelectionRange(0, editor.value.length);
}

function hideEditor() {
  editor.style.display = 'none';
  editor.dataset.textId = '';
}

function applyEditorStyle(T) {
  editor.style.color = T.color;
  editor.style.fontFamily = T.family;
  editor.style.fontWeight = T.weight;
  const scale = cssScale();
  editor.style.fontSize = T.size * scale + 'px';
  editor.style.lineHeight = T.line;
  // text-align в textarea влияет на выравнивание текста внутри textarea
  editor.style.textAlign = T.align;
  
  const pad = state.push.padding;
  const contentW = state.push.w - pad * 2;
  const maxW = Math.max(1, contentW - T.x);
  // Для расчета максимальной ширины используем размеры canvas в CSS
  const canvasWidthCss = canvas.clientWidth || parseFloat(getComputedStyle(canvas).width) || 0;
  const canvasLeft = canvas.offsetLeft;
  const currentLeft = parseFloat(editor.style.left) || 0;
  const canvasRight = canvasLeft + canvasWidthCss;
  const maxEditorWidth = canvasRight - currentLeft - 10;
  
  ctx.save();
  ctx.font = `${T.weight} ${T.size}px ${cssFont(T.family)}`;
  
  // Вычисляем ширину ТОЧНО так же, как в drawText и showEditorFor
  const textLines = T.text.split('\n');
  const allLines = [];
  for (const textLine of textLines) {
    if (textLine.trim() === '') {
      allLines.push('');
    } else {
      const wrapped = wrap(ctx, textLine, maxW, T);
      allLines.push(...wrapped);
    }
  }
  
  let textWidth = 0;
  for (const ln of allLines) {
    if (ln) {
      textWidth = Math.max(textWidth, ctx.measureText(ln).width);
    }
  }
  ctx.restore();
  
  // Вычисляем высоту с учетом количества строк
  const lineCount = Math.max(1, allLines.length);
  const lineHeight = T.size * T.line * scale;
  const editorPadding = 8; // padding: 2px 4px = 4px сверху + 4px снизу
  const minHeight = lineCount * lineHeight + editorPadding;
  
  editor.style.width = Math.min(Math.max(200, textWidth * scale + editorPadding + 10), maxEditorWidth) + 'px';
  editor.style.height = Math.max(minHeight, 50) + 'px';
  editor.style.background = 'rgba(255,255,255,0.95)';
  editor.style.border = '2px dashed ' + (T.color === '#111111' || T.color === '#000000' ? '#2a7de1' : '#000');
}

let lastCommittedText = '';
let historyPushedForEdit = false;

function commitEditor(skipHistory = false) {
  const id = editor.dataset.textId;
  const T = state.texts.find(x => x.id === id);
  if (T) {
    const newText = editor.value || editor.textContent || '';
    
    // Добавляем в историю только при первом изменении или при явном сохранении
    if (!skipHistory && !historyPushedForEdit && newText !== lastCommittedText) {
      pushHistory('editText');
      historyPushedForEdit = true;
    }
    
    // Сохраняем текст с переносами строк (для textarea используем value)
    T.text = newText;
    lastCommittedText = newText;
  }
}

// Рендер цикл
function loop() {
  draw();
  state.runtime.raf = requestAnimationFrame(loop);
}

// Предпросмотр и запись
function startPreview() {
  state.runtime.preview = true;
  state.runtime.playing = true;
  state.runtime.t0 = performance.now();
  hideEditor();
}

function stopAll() {
  state.runtime.preview = false;
  state.runtime.playing = false;
  state.runtime.t0 = 0;
  if (state.runtime.recorder) {
    try {
      state.runtime.recorder.stop();
    } catch (e) {}
    state.runtime.recorder = null;
  }
}

async function recordVideo() {
  const format = ui.exportFormat?.value || 'webm';
  
  if (format === 'mp4') {
    // Для MP4 сначала записываем WebM, потом конвертируем
    await recordWebMForMP4();
  } else {
    await recordWebM();
  }
}

async function recordWebM() {
  await ensureFontsLoaded();
  const fps = parseInt(ui.fps.value || 30);
  const bits = parseInt(ui.vbr.value || 8000000);
  const stream = canvas.captureStream(fps);
  state.runtime.chunks = [];
  const opts = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: bits };
  let rec;
  try {
    rec = new MediaRecorder(stream, opts);
  } catch (e) {
    rec = new MediaRecorder(stream);
  }
  rec.ondataavailable = e => {
    if (e.data && e.data.size) state.runtime.chunks.push(e.data);
  };
  rec.onstop = () => {
    const blob = new Blob(state.runtime.chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `push-${state.stage.w}x${state.stage.h}-${ts}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    state.runtime.chunks = [];
    state.runtime.recording = false;
  };
  state.runtime.recorder = rec;

  const A = state.anim;
  const total = A.beforeStart + A.delay + A.in + A.hold + A.out + A.afterEnd + 0.1;
  state.runtime.recording = true;
  hideEditor();
  rec.start();
  state.runtime.playing = true;
  state.runtime.preview = false;
  state.runtime.t0 = performance.now();

  setTimeout(() => {
    try {
      rec.stop();
    } catch (e) {}
    state.runtime.playing = false;
  }, Math.ceil(total * 1000));
}

async function recordWebMForMP4() {
  await ensureFontsLoaded();
  
  // Проверяем доступность HTTPS (требуется для FFmpeg Web Workers)
  const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
  if (!isSecure) {
    const useWebM = confirm(
      'Экспорт в MP4 требует HTTPS соединения.\n\n' +
      'На HTTP доступен только WebM формат.\n\n' +
      'Нажмите OK чтобы скачать WebM, или Отмена для выбора другого формата.'
    );
    if (useWebM) {
      await recordWebM();
    }
    return;
  }
  
  // Показываем уведомление о загрузке FFmpeg
  if (!ffmpegLoaded) {
    ui.btnRecord.disabled = true;
    ui.btnRecord.textContent = 'Загрузка FFmpeg...';
    await initFFmpeg();
    ui.btnRecord.disabled = false;
    ui.btnRecord.textContent = 'Записать видео';
  }
  
  if (!ffmpegLoaded || !ffmpeg) {
    alert('FFmpeg не загружен. Используйте WebM формат или обновите страницу.');
    return;
  }

  const fps = parseInt(ui.fps.value || 30);
  const bits = parseInt(ui.vbr.value || 8000000);
  const stream = canvas.captureStream(fps);
  state.runtime.chunks = [];
  const opts = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: bits };
  let rec;
  try {
    rec = new MediaRecorder(stream, opts);
  } catch (e) {
    rec = new MediaRecorder(stream);
  }
  
  rec.ondataavailable = e => {
    if (e.data && e.data.size) state.runtime.chunks.push(e.data);
  };
  
  rec.onstop = async () => {
    const webmBlob = new Blob(state.runtime.chunks, { type: 'video/webm' });
    
    // Конвертируем WebM в MP4
    try {
      ui.btnRecord.disabled = true;
      ui.btnRecord.textContent = 'Конвертация в MP4...';
      
      // Убеждаемся, что FFmpeg загружен
      if (!ffmpegLoaded || !ffmpeg) {
        ui.btnRecord.textContent = 'Загрузка FFmpeg...';
        try {
          await initFFmpeg();
        } catch (e) {
          console.error('Ошибка загрузки FFmpeg:', e);
        }
        if (!ffmpegLoaded || !ffmpeg) {
          throw new Error('FFmpeg не удалось загрузить. Проверьте подключение к интернету и обновите страницу.');
        }
      }
      
      const webmData = new Uint8Array(await webmBlob.arrayBuffer());
      await ffmpeg.writeFile('input.webm', webmData);
      
      await ffmpeg.exec([
        '-i', 'input.webm',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        'output.mp4'
      ]);
      
      const mp4Data = await ffmpeg.readFile('output.mp4');
      // mp4Data может быть Uint8Array, ArrayBuffer или другим типом
      const mp4Blob = mp4Data instanceof Uint8Array 
        ? new Blob([mp4Data], { type: 'video/mp4' })
        : new Blob([mp4Data.buffer || mp4Data], { type: 'video/mp4' });
      
      const url = URL.createObjectURL(mp4Blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `push-${state.stage.w}x${state.stage.h}-${ts}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // Очистка
      try {
        await ffmpeg.deleteFile('input.webm');
        await ffmpeg.deleteFile('output.mp4');
      } catch (e) {
        // Игнорируем ошибки очистки
      }
    } catch (e) {
      console.error('Ошибка конвертации:', e);
      alert('Ошибка конвертации в MP4: ' + (e.message || e.toString()) + '\n\nПопробуйте использовать WebM формат или обновите страницу.');
    } finally {
      ui.btnRecord.disabled = false;
      ui.btnRecord.textContent = 'Записать видео';
      state.runtime.chunks = [];
      state.runtime.recording = false;
    }
  };
  
  state.runtime.recorder = rec;

  const A = state.anim;
  const total = A.beforeStart + A.delay + A.in + A.hold + A.out + A.afterEnd + 0.1;
  state.runtime.recording = true;
  hideEditor();
  rec.start();
  state.runtime.playing = true;
  state.runtime.preview = false;
  state.runtime.t0 = performance.now();

  setTimeout(() => {
    try {
      rec.stop();
    } catch (e) {}
    state.runtime.playing = false;
  }, Math.ceil(total * 1000));
}

async function ensureFontsLoaded() {
  const fams = new Set(state.texts.map(t => t.family));
  const waits = [];
  fams.forEach(f => {
    waits.push(document.fonts.load(`400 12px ${cssFont(f)}`));
    waits.push(document.fonts.load(`700 12px ${cssFont(f)}`));
    waits.push(document.fonts.load(`900 12px ${cssFont(f)}`));
  });
  try {
    await Promise.all(waits);
  } catch (e) {}
}

function renderPushThumb() {
  const TW = 480;
  const TH = 270;
  const oc = document.createElement('canvas');
  oc.width = TW;
  oc.height = TH;
  const octx = oc.getContext('2d');
  octx.fillStyle = '#0f1218';
  octx.fillRect(0, 0, TW, TH);
  const P = state.push;
  const scale = Math.min((TW - 20) / P.w, (TH - 20) / P.h);
  octx.save();
  octx.translate(TW / 2, TH / 2);
  octx.scale(scale, scale);
  octx.translate(-P.w / 2, -P.h / 2);
  octx.shadowColor = 'rgba(0,0,0,0.25)';
  octx.shadowBlur = P.shadow;
  octx.shadowOffsetY = 2;
  octx.fillStyle = P.color;
  octx.fill(roundRect(0, 0, P.w, P.h, P.r));
  const pad = P.padding;
  const contentX = pad;
  const contentY = pad;
  const contentW = P.w - pad * 2;
  const contentH = P.h - pad * 2;
  const imgS = state.img.size;
  const imgX = contentX + state.img.offX;
  const imgY = contentY + state.img.offY + (contentH - imgS) / 2;
  if (state.img.image) {
    octx.save();
    if (state.img.shape === 'circle') {
      const r = imgS / 2;
      octx.beginPath();
      octx.arc(imgX + r, imgY + r, r, 0, Math.PI * 2);
      octx.clip();
    } else if (state.img.shape === 'rounded') {
      octx.clip(roundRect(imgX, imgY, imgS, imgS, state.img.radius));
    }
    octx.drawImage(state.img.image, imgX, imgY, imgS, imgS);
    octx.restore();
  } else {
    octx.save();
    octx.globalAlpha = 0.08;
    octx.fillStyle = '#000';
    octx.fillRect(imgX, imgY, imgS, imgS);
    octx.restore();
  }
  for (const T of state.texts) {
    octx.save();
    const x = contentX + T.x;
    const y = contentY + T.y;
    octx.font = `${T.weight} ${T.size}px ${cssFont(T.family)}`;
    octx.fillStyle = T.color;
    octx.textAlign = T.align;
    octx.textBaseline = 'top';
    const maxW = contentW - T.x;
    
    // Разбиваем текст на строки (учитываем переносы строк)
    const textLines = T.text.split('\n');
    const allLines = [];
    
    for (const textLine of textLines) {
      if (textLine.trim() === '') {
        allLines.push('');
      } else {
        const wrapped = wrapCanvas(octx, textLine, maxW, T);
        allLines.push(...wrapped);
      }
    }
    
    const step = T.size * T.line;
    let dx = x;
    if (T.align === 'center') dx = x + maxW / 2;
    if (T.align === 'right') dx = x + maxW;
    let yy = y;
    
    // Базовая интенсивность блюра (используется как значение по умолчанию, если не указана в маркере)
    const defaultBlurIntensity = T.blurIntensity || 0;
    
    for (const ln of allLines) {
      if (ln.length === 0) {
        yy += step;
        continue;
      }
      
      // Рисуем текст с поддержкой множественных блюров через синтаксис [текст:степень]
      drawTextWithMultipleBlurs(octx, ln, defaultBlurIntensity, dx, yy, T.align);
      yy += step;
    }
    octx.restore();
  }
  octx.restore();
  return oc.toDataURL('image/png');
}

function init() {
  canvas = $('#stage');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  editor = $('#editor');
  if (!ctx) return;
  
  ui = {
    customW: $('#customW'), customH: $('#customH'), preset: $('#preset'),
    bgColor: $('#bgColor'), bgAlpha: $('#bgAlpha'), bgAlphaValue: $('#bgAlphaValue'),
    previewScale: $('#previewScale'), previewScaleValue: $('#previewScaleValue'),
    imgShape: $('#imgShape'), imgSize: $('#imgSize'), imgRadius: $('#imgRadius'),
    fontFamily: $('#fontFamily'), fontWeight: $('#fontWeight'), fontSize: $('#fontSize'), 
    fontColor: $('#fontColor'), fontAlign: $('#fontAlign'), lineHeight: $('#lineHeight'),
    blurIntensity: $('#blurIntensity'),
    btnAddText: $('#btnAddText'), btnCenter: $('#btnCenter'),
    aBeforeStart: $('#aBeforeStart'), aDelay: $('#aDelay'), aIn: $('#aIn'), aInDirection: $('#aInDirection'), 
    aHold: $('#aHold'), aOut: $('#aOut'), aOutDirection: $('#aOutDirection'), aAfterEnd: $('#aAfterEnd'),
    pressEnabled: $('#pressEnabled'), pressAt: $('#pressAt'), pressDur: $('#pressDur'), pressDepth: $('#pressDepth'),
    btnPreview: $('#btnPreview'), btnStop: $('#btnStop'), btnRecord: $('#btnRecord'),
    hiddenImgInput: $('#hiddenImgInput'),
    pushColor: $('#pushColor'), pushOpacity: $('#pushOpacity'), pushRadius: $('#pushRadius'), pushShadow: $('#pushShadow'),
    fps: $('#fps'), vbr: $('#vbr'), exportFormat: $('#exportFormat'),
    tplName: $('#tplName'), btnSaveTpl: $('#btnSaveTpl'), btnSaveAsNew: $('#btnSaveAsNew'),
    btnExportTpl: $('#btnExportTpl'), btnImportTpl: $('#btnImportTpl'), tplGrid: $('#tplGrid')
  };
  
  initTabs();
  setupEventListeners();
  
  canvas.width = state.stage.w;
  canvas.height = state.stage.h;
  
  applyUI();
  updateCanvasCssSize();
  ensureFontsLoaded();
  
  // Загружаем FFmpeg только если HTTPS (иначе Web Workers не работают)
  const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
  if (isSecure) {
    initFFmpeg().catch(e => {
      console.warn('FFmpeg будет загружен при необходимости:', e);
    });
  } else {
    console.info('FFmpeg недоступен на HTTP. Для MP4 экспорта используйте HTTPS.');
  }
  
  initTemplatesDir(); // Инициализируем работу с шаблонами
  loop();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
