// Управление состоянием приложения

import { uid } from './utils.js';

// Базовый URL API (автоопределение)
const API_BASE = window.location.origin + '/api';

export function createInitialState() {
  return {
    stage: { w: 1080, h: 1920, bg: "#09c35a", bgAlpha: 1, previewScale: 0.33 },
    push: { x: 60, y: 160, w: 960, h: 180, r: 20, color: "#ffffff", opacity: 1, shadow: 18, padding: 20 },
    img: { src: null, image: null, shape: "rounded", radius: 18, size: 120, offX: 0, offY: 0 },
    texts: [
      { id: uid(), text: "Новое сообщение", x: 140, y: 26, family: "Inter", weight: "700", size: 44, color: "#111111", align: "left", line: 1.1, blurIntensity: 10 },
      { id: uid(), text: "Короткое описание уведомления", x: 140, y: 76, family: "Inter", weight: "400", size: 30, color: "#333333", align: "left", line: 1.15, blurIntensity: 10 },
      { id: uid(), text: "now", x: 140, y: 128, family: "Inter", weight: "600", size: 26, color: "#1b7ae0", align: "left", line: 1.1, blurIntensity: 10 }
    ],
    anim: { beforeStart: 0, delay: 0, in: 0.6, hold: 1.4, out: 0.6, afterEnd: 1, inDirection: 'top', outDirection: 'top', pressOn: true, pressAt: 1.0, pressDur: 0.18, pressDepth: 0.06 },
    runtime: { playing: false, recording: false, t0: 0, recorder: null, chunks: [], raf: 0, preview: false },
    selection: { target: null, textId: null, mode: null, start: { x: 0, y: 0 }, orig: {} }
  };
}

export const state = createInitialState();

// История действий - Ctrl+Z
export const history = [];

export function pushHistory(label) {
  const snapshot = JSON.stringify(serialize(true));
  history.push(snapshot);
  if (history.length > 50) history.shift();
}

export function undo(deserializeFn, applyUIFn, hideEditorFn) {
  if (history.length < 1) return;
  const snap = history.pop();
  const prev = JSON.parse(snap);
  deserializeFn(prev, true);
  applyUIFn();
  hideEditorFn();
}

export function serialize(withImage) {
  const data = JSON.parse(JSON.stringify(state));
  delete data.runtime;
  delete data.selection;
  
  // Используем уже сохраненный dataURL (base64) для изображения
  if (withImage && state.img.dataURL) {
    data.img.dataURL = state.img.dataURL;
  }
  
  // Удаляем blob URL, так как он не будет работать после перезагрузки
  if (data.img) {
    delete data.img.src;
  }
  
  return data;
}

export function deserialize(json, withImage) {
  ['stage', 'push', 'img', 'anim'].forEach(k => {
    if (json[k]) state[k] = Object.assign({}, state[k], json[k]);
  });
  if (Array.isArray(json.texts)) {
    // Добавляем поля блюра по умолчанию для старых шаблонов
    state.texts = json.texts.map(t => ({
      ...t,
      blurIntensity: t.blurIntensity !== undefined ? t.blurIntensity : 10
    }));
  }
  
  // Восстанавливаем изображение из base64 или blob URL
  if (withImage && json.img) {
    const img = new Image();
    img.onload = () => { 
      state.img.image = img;
      // Сохраняем dataURL для будущих сохранений
      if (json.img.dataURL) {
        state.img.dataURL = json.img.dataURL;
        state.img.src = json.img.dataURL;
      } else if (json.img.src) {
        // Для старых шаблонов с blob URL - конвертируем в base64
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
        state.img.src = json.img.src;
      }
    };
    img.onerror = () => {
      console.error('Ошибка загрузки изображения из шаблона');
      state.img.image = null;
      state.img.src = null;
      state.img.dataURL = null;
    };
    
    // Приоритет: dataURL (base64) > src (blob URL для старых шаблонов)
    if (json.img.dataURL) {
      img.src = json.img.dataURL;
    } else if (json.img.src) {
      img.src = json.img.src;
    }
  } else if (!withImage && json.img) {
    // Если изображение не нужно загружать, очищаем его
    state.img.image = null;
    state.img.src = null;
    state.img.dataURL = null;
  }
}

export function clampPush() {
  const P = state.push;
  const W = state.stage.w;
  const H = state.stage.h;
  P.x = Math.min(Math.max(P.x, 0), W - P.w);
  P.y = Math.min(Math.max(P.y, 0), H - P.h);
}

// ============================================
// API для работы с шаблонами на сервере
// ============================================

let templatesCache = {};
let apiAvailable = null; // null = не проверено, true/false = результат

// Проверка доступности API
async function checkApiAvailable() {
  if (apiAvailable !== null) return apiAvailable;
  
  try {
    const response = await fetch(`${API_BASE}/health`, { 
      method: 'GET',
      timeout: 3000 
    });
    apiAvailable = response.ok;
  } catch (e) {
    apiAvailable = false;
  }
  
  console.log(`API шаблонов: ${apiAvailable ? 'доступен' : 'недоступен (локальный режим)'}`);
  return apiAvailable;
}

// Инициализация - загрузка шаблонов
export async function initTemplatesDir() {
  await checkApiAvailable();
  
  // Загружаем старые шаблоны из localStorage для совместимости
  try {
    const oldTpls = JSON.parse(localStorage.getItem('pushTpls_v3_previews') || '{}');
    if (Object.keys(oldTpls).length > 0) {
      templatesCache = oldTpls;
    }
  } catch (e) {
    console.error('Ошибка загрузки старых шаблонов:', e);
  }
  
  // Если API доступен, загружаем шаблоны с сервера
  if (apiAvailable) {
    try {
      const serverTemplates = await fetchTemplatesList();
      // Объединяем с локальными (серверные приоритетнее)
      for (const tpl of serverTemplates) {
        templatesCache[tpl.name] = {
          id: tpl.id,
          thumb: tpl.thumb,
          created: tpl.created,
          updated: tpl.updated,
          fromServer: true
        };
      }
    } catch (e) {
      console.error('Ошибка загрузки шаблонов с сервера:', e);
    }
  }
}

// Получить список шаблонов с сервера
async function fetchTemplatesList() {
  const response = await fetch(`${API_BASE}/templates`);
  if (!response.ok) throw new Error('Ошибка загрузки списка шаблонов');
  return await response.json();
}

// Получить полные данные шаблона с сервера
async function fetchTemplate(id) {
  const response = await fetch(`${API_BASE}/templates/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('Шаблон не найден');
  return await response.json();
}

// Сохранить шаблон на сервер
async function saveTemplateToServer(name, data, thumb) {
  const response = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data, thumb })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Ошибка сохранения');
  }
  
  return await response.json();
}

// Обновить шаблон на сервере
async function updateTemplateOnServer(id, name, data, thumb) {
  const response = await fetch(`${API_BASE}/templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data, thumb })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Ошибка обновления');
  }
  
  return await response.json();
}

// Удалить шаблон с сервера
async function deleteTemplateFromServer(id) {
  const response = await fetch(`${API_BASE}/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Ошибка удаления');
  }
  
  return await response.json();
}

// ============================================
// Публичные функции для работы с шаблонами
// ============================================

// Получить список шаблонов
export async function readTpls() {
  // Обновляем список с сервера если доступен
  if (await checkApiAvailable()) {
    try {
      const serverTemplates = await fetchTemplatesList();
      // Обновляем кеш
      const newCache = {};
      for (const tpl of serverTemplates) {
        newCache[tpl.name] = {
          id: tpl.id,
          thumb: tpl.thumb,
          created: tpl.created,
          updated: tpl.updated,
          fromServer: true
        };
      }
      templatesCache = newCache;
    } catch (e) {
      console.error('Ошибка обновления списка шаблонов:', e);
    }
  }
  
  return templatesCache;
}

// Загрузить данные конкретного шаблона
export async function loadTemplate(name) {
  const cached = templatesCache[name];
  
  // Если шаблон с сервера - загружаем полные данные
  if (cached && cached.fromServer && cached.id) {
    try {
      const full = await fetchTemplate(cached.id);
      return full.data;
    } catch (e) {
      console.error('Ошибка загрузки шаблона:', e);
      throw e;
    }
  }
  
  // Локальный шаблон
  if (cached && cached.data) {
    return cached.data;
  }
  
  throw new Error('Шаблон не найден');
}

// Сохранить шаблон (всегда как новый на сервере)
export async function writeTpl(name, data, thumb) {
  // Проверяем доступность API
  if (!await checkApiAvailable()) {
    alert('Сервер недоступен. Проверьте подключение.');
    return false;
  }
  
  try {
    const result = await saveTemplateToServer(name, data, thumb);
    templatesCache[name] = {
      id: result.id,
      data: data,
      thumb: thumb,
      fromServer: true,
      created: result.created
    };
    console.log('Шаблон сохранён на сервере:', name);
    return true;
  } catch (e) {
    console.error('Ошибка сохранения на сервер:', e);
    alert('Ошибка сохранения: ' + e.message);
    return false;
  }
}

// Удалить шаблон
export async function deleteTpl(name) {
  const cached = templatesCache[name];
  
  // Удаляем с сервера если это серверный шаблон
  if (cached && cached.fromServer && cached.id && await checkApiAvailable()) {
    try {
      await deleteTemplateFromServer(cached.id);
      console.log('Шаблон удалён с сервера:', name);
    } catch (e) {
      console.error('Ошибка удаления с сервера:', e);
      // Продолжаем удаление из кеша
    }
  }
  
  // Удаляем из кеша
  delete templatesCache[name];
  return true;
}

// ============================================
// Локальное сохранение (fallback)
// ============================================

let templatesDirHandle = null;

export function getTemplatesDirHandle() {
  return templatesDirHandle;
}

export function setTemplatesDirHandle(handle) {
  templatesDirHandle = handle;
}

async function saveTemplateLocally(name, data, thumb) {
  if (!('showSaveFilePicker' in window)) {
    console.warn('File System Access API не поддерживается');
    return false;
  }
  
  try {
    let fileHandle;
    const dirHandle = getTemplatesDirHandle();
    
    if (dirHandle) {
      try {
        fileHandle = await dirHandle.getFileHandle(`${name}.json`, { create: true });
      } catch (e) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: `${name}.json`,
          types: [{ description: 'JSON шаблон', accept: { 'application/json': ['.json'] } }]
        });
      }
    } else {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: `${name}.json`,
        types: [{ description: 'JSON шаблон', accept: { 'application/json': ['.json'] } }]
      });
    }
    
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ name, data, thumb, created: Date.now() }, null, 2));
    await writable.close();
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Ошибка локального сохранения:', e);
    }
    return false;
  }
}

export async function loadTemplatesFromFiles() {
  if (!('showDirectoryPicker' in window)) {
    alert('File System Access API не поддерживается. Используйте импорт .json');
    return templatesCache;
  }
  
  try {
    const dirHandle = await window.showDirectoryPicker({ startIn: 'downloads' });
    setTemplatesDirHandle(dirHandle);
    
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.json')) {
        try {
          const file = await entry.getFile();
          const text = await file.text();
          const template = JSON.parse(text);
          const name = template.name || entry.name.replace('.json', '');
          
          if (template.data) {
            templatesCache[name] = {
              data: template.data,
              thumb: template.thumb || null,
              fromServer: false
            };
          }
        } catch (e) {
          console.error(`Ошибка загрузки ${entry.name}:`, e);
        }
      }
    }
    
    return templatesCache;
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Ошибка загрузки:', e);
    }
    return templatesCache;
  }
}
