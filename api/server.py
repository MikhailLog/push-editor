#!/usr/bin/env python3
"""
API сервер для работы с шаблонами пуш-уведомлений.
"""

import os
import json
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Папка для хранения шаблонов
TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'templates')

def ensure_templates_dir():
    """Создать папку templates если не существует."""
    if not os.path.exists(TEMPLATES_DIR):
        os.makedirs(TEMPLATES_DIR)

def get_template_path(template_id):
    """Получить путь к файлу шаблона."""
    # Защита от path traversal
    safe_id = os.path.basename(template_id)
    if not safe_id.endswith('.json'):
        safe_id += '.json'
    return os.path.join(TEMPLATES_DIR, safe_id)

@app.route('/api/templates', methods=['GET'])
def list_templates():
    """Получить список всех шаблонов."""
    ensure_templates_dir()
    templates = []
    
    for filename in os.listdir(TEMPLATES_DIR):
        if filename.endswith('.json'):
            filepath = os.path.join(TEMPLATES_DIR, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    templates.append({
                        'id': filename[:-5],  # без .json
                        'name': data.get('name', filename[:-5]),
                        'thumb': data.get('thumb', ''),
                        'created': data.get('created', ''),
                        'updated': data.get('updated', '')
                    })
            except (json.JSONDecodeError, IOError):
                continue
    
    # Сортировка по дате обновления (новые первые)
    templates.sort(key=lambda x: x.get('updated', x.get('created', '')), reverse=True)
    return jsonify(templates)

@app.route('/api/templates/<template_id>', methods=['GET'])
def get_template(template_id):
    """Получить шаблон по ID."""
    filepath = get_template_path(template_id)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Шаблон не найден'}), 404
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            data['id'] = template_id
            return jsonify(data)
    except (json.JSONDecodeError, IOError) as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/templates', methods=['POST'])
def create_template():
    """Создать новый шаблон."""
    ensure_templates_dir()
    
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных'}), 400
    
    # Генерируем ID если не указан
    template_id = data.get('id') or str(uuid.uuid4())[:8]
    name = data.get('name', template_id)
    
    # Создаём безопасное имя файла
    safe_name = "".join(c for c in name if c.isalnum() or c in '-_ ').strip()
    if not safe_name:
        safe_name = template_id
    
    filepath = get_template_path(safe_name)
    
    # Если файл существует, добавляем суффикс
    counter = 1
    original_path = filepath
    while os.path.exists(filepath):
        safe_name_with_counter = f"{safe_name}-{counter}"
        filepath = get_template_path(safe_name_with_counter)
        counter += 1
    
    now = datetime.now().isoformat()
    template_data = {
        'name': name,
        'data': data.get('data', {}),
        'thumb': data.get('thumb', ''),
        'created': now,
        'updated': now
    }
    
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(template_data, f, ensure_ascii=False, indent=2)
        
        final_id = os.path.basename(filepath)[:-5]
        return jsonify({
            'id': final_id,
            'name': name,
            'created': now,
            'message': 'Шаблон сохранён'
        }), 201
    except IOError as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/templates/<template_id>', methods=['PUT'])
def update_template(template_id):
    """Обновить существующий шаблон."""
    filepath = get_template_path(template_id)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Шаблон не найден'}), 404
    
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных'}), 400
    
    try:
        # Читаем существующие данные
        with open(filepath, 'r', encoding='utf-8') as f:
            existing = json.load(f)
        
        # Обновляем
        now = datetime.now().isoformat()
        existing['name'] = data.get('name', existing.get('name'))
        existing['data'] = data.get('data', existing.get('data'))
        existing['thumb'] = data.get('thumb', existing.get('thumb'))
        existing['updated'] = now
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'id': template_id,
            'name': existing['name'],
            'updated': now,
            'message': 'Шаблон обновлён'
        })
    except (json.JSONDecodeError, IOError) as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/templates/<template_id>', methods=['DELETE'])
def delete_template(template_id):
    """Удалить шаблон."""
    filepath = get_template_path(template_id)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Шаблон не найден'}), 404
    
    try:
        os.remove(filepath)
        return jsonify({'message': 'Шаблон удалён'})
    except IOError as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """Проверка работоспособности API."""
    return jsonify({'status': 'ok', 'version': '1.0'})

if __name__ == '__main__':
    ensure_templates_dir()
    app.run(host='127.0.0.1', port=5050, debug=False)
