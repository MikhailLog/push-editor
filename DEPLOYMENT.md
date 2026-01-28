# Деплой редактора пуш-уведомлений

## Информация о проекте

- **Тип**: Статический фронтенд (HTML/CSS/JS)
- **Зависимости**: Нет (все библиотеки загружаются через CDN)
- **Требования**: Веб-сервер с поддержкой статических файлов

## Структура для деплоя

```
push-editor/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── state.js
│   └── utils.js
└── templates/
    └── README.md
```

## Деплой на Hostinger

### 1. Подготовка на сервере

```bash
# Создать директорию проекта
sudo mkdir -p /opt/scripts/push-editor

# Клонировать репозиторий
cd /opt/scripts
sudo git clone https://github.com/YOUR_USERNAME/push-editor.git

# Или обновить существующий
cd /opt/scripts/push-editor
sudo git pull origin main
```

### 2. Настройка Nginx

Создать конфигурацию `/etc/nginx/sites-available/push-editor`:

```nginx
server {
    listen 80;
    server_name push-editor.your-domain.com;
    
    root /opt/scripts/push-editor;
    index index.html;
    
    # Кэширование статики
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
    
    # Заголовки для ES modules и FFmpeg WASM
    location / {
        add_header Cross-Origin-Opener-Policy same-origin;
        add_header Cross-Origin-Embedder-Policy require-corp;
        try_files $uri $uri/ /index.html;
    }
}
```

Активировать конфигурацию:

```bash
sudo ln -s /etc/nginx/sites-available/push-editor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. HTTPS (рекомендуется)

```bash
sudo certbot --nginx -d push-editor.your-domain.com
```

## Альтернативные варианты деплоя

### GitHub Pages

1. В настройках репозитория: Settings → Pages
2. Source: Deploy from a branch
3. Branch: main, folder: / (root)
4. Сайт будет доступен по адресу: `https://username.github.io/push-editor/`

**Примечание**: FFmpeg WASM может не работать на GitHub Pages из-за ограничений CORS/COOP/COEP.

### Netlify / Vercel

Просто подключить репозиторий — деплой произойдёт автоматически.

## Обновление

```bash
cd /opt/scripts/push-editor
sudo git pull origin main
# Nginx автоматически подхватит изменения
```

## Проверка

После деплоя проверить:
- [ ] Главная страница открывается
- [ ] Стили загружаются корректно
- [ ] JS модули работают (нет ошибок в консоли)
- [ ] Экспорт в WebM работает
- [ ] Экспорт в MP4 работает (FFmpeg загружается)

## Порты

Этот проект **не требует отдельного порта** — это статические файлы, которые обслуживаются Nginx напрямую.

## Примечания

- Проект использует ES6 модули — требуется веб-сервер (не работает через `file://`)
- FFmpeg загружается с CDN (unpkg/jsdelivr) динамически при экспорте в MP4
- Шаблоны сохраняются локально в браузере пользователя (localStorage + File System API)
