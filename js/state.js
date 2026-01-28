// Управление состоянием приложения

import { uid } from './utils.js';

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
    anim: { beforeStart: 0, delay: 0, in: 0.6, hold: 1.4, out: 0.6, afterEnd: 0, inDirection: 'top', outDirection: 'top', pressOn: true, pressAt: 1.0, pressDur: 0.18, pressDepth: 0.06 },
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

// Шаблоны - теперь сохраняются в папку templates проекта
let templatesCache = {};
let templatesDirHandle = null;

export function getTemplatesDirHandle() {
  return templatesDirHandle;
}

export function setTemplatesDirHandle(handle) {
  templatesDirHandle = handle;
}

export async function initTemplatesDir() {
  // Инициализация - загружаем старые шаблоны из localStorage для совместимости
  try {
    const oldTpls = JSON.parse(localStorage.getItem('pushTpls_v3_previews') || '{}');
    if (Object.keys(oldTpls).length > 0) {
      templatesCache = oldTpls;
      // Мигрируем старые шаблоны в файлы
      // Старые шаблоны из localStorage будут доступны до первой загрузки из папки
    }
  } catch (e) {
    console.error('Ошибка загрузки старых шаблонов:', e);
  }
}

export async function readTpls() {
  // Возвращаем кеш
  return templatesCache || {};
}

export async function writeTpl(name, data, thumb) {
  // Сохраняем в кеш
  if (!templatesCache[name]) {
    templatesCache[name] = {};
  }
  templatesCache[name].data = data;
  templatesCache[name].thumb = thumb;
  
  // Пытаемся сохранить в файл через File System Access API
  if ('showSaveFilePicker' in window) {
    try {
      let fileHandle;
      
      // Если уже выбрана папка templates, используем её напрямую
      const dirHandle = getTemplatesDirHandle();
      if (dirHandle) {
        try {
          // Пытаемся создать или получить файл в выбранной папке
          fileHandle = await dirHandle.getFileHandle(`${name}.json`, { create: true });
        } catch (e) {
          console.error('Ошибка создания файла в выбранной папке:', e);
          // Если не получилось, используем showSaveFilePicker
          fileHandle = await window.showSaveFilePicker({
            suggestedName: `${name}.json`,
            types: [{
              description: 'JSON шаблон',
              accept: { 'application/json': ['.json'] }
            }],
            startIn: 'downloads'
          });
        }
      } else {
        // Если папка не выбрана, предлагаем выбрать
        fileHandle = await window.showSaveFilePicker({
          suggestedName: `${name}.json`,
          types: [{
            description: 'JSON шаблон',
            accept: { 'application/json': ['.json'] }
          }],
          startIn: 'downloads'
        });
      }
      
      const writable = await fileHandle.createWritable();
      const templateData = {
        name,
        data,
        thumb,
        created: Date.now()
      };
      await writable.write(JSON.stringify(templateData, null, 2));
      await writable.close();
      
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Ошибка сохранения шаблона:', e);
      }
      return false;
    }
  }
  
  return false;
}

export async function deleteTpl(name) {
  // Удаляем из кеша
  if (templatesCache[name]) {
    delete templatesCache[name];
  }
  
  // Пытаемся удалить файл, если есть доступ к папке
  const dirHandle = getTemplatesDirHandle();
  if (dirHandle) {
    try {
      await dirHandle.removeEntry(`${name}.json`, { recursive: false });
      return true;
    } catch (e) {
      console.error(`Ошибка удаления файла шаблона ${name}:`, e);
      // Файл может не существовать, но это не критично - главное удалить из кеша
      return true;
    }
  }
  
  // Если нет доступа к папке, просто удаляем из кеша
  return true;
}

export async function loadTemplatesFromFiles() {
  if (!('showDirectoryPicker' in window)) {
    alert('File System Access API не поддерживается в вашем браузере. Используйте кнопку "Импорт .json" для загрузки отдельных шаблонов.');
    return templatesCache;
  }
  
  try {
    const dirHandle = await window.showDirectoryPicker({
      startIn: 'downloads'
    });
    
    setTemplatesDirHandle(dirHandle);
    const templates = {};
    
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.json')) {
        try {
          const file = await entry.getFile();
          const text = await file.text();
          const template = JSON.parse(text);
          
          if (template.name && template.data) {
            templates[template.name] = {
              data: template.data,
              thumb: template.thumb || null
            };
          } else if (template.data) {
            // Старый формат без поля name
            const name = entry.name.replace('.json', '');
            templates[name] = {
              data: template.data,
              thumb: template.thumb || null
            };
          }
        } catch (e) {
          console.error(`Ошибка загрузки шаблона ${entry.name}:`, e);
        }
      }
    }
    
    templatesCache = templates;
    return templates;
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Ошибка загрузки шаблонов:', e);
      alert('Ошибка загрузки шаблонов: ' + e.message);
    }
    return templatesCache;
  }
}
