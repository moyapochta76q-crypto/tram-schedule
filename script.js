let scheduleData = [];
let allTrams = new Map();

const stopDictionary = {
    // Маршрут 6
    'серебрянка': 'Серебрянка',
    'поликлиника': 'Поликлиника 18',
    'партизанская': 'ст.м. Партизанская',
    'уральская': 'Уральская',
    'бядули': 'пл. Змитрока Бядули',
    'змитрока бядули': 'пл. Змитрока Бядули',
    'волгоградская': 'Волгоградская',
    'зелёный луг': 'Зелёный Луг',
    'зеленый луг': 'Зелёный Луг',
    'парк': 'Парк',
    // Другие маршруты
    'мясникова': 'пл. Мясникова',
    'пл. мясникова': 'пл. Мясникова',
    'динамо': 'Стадион "Динамо"',
    'стадион': 'Стадион "Динамо"',
    'озеро': 'Озеро',
    'куйбышева': 'Куйбышева',
    'рокоссовского': 'просп. Рокоссовского',
    'немига': 'Немига'
};

function normalizeStopName(name) {
    if (!name) return '';
    const lower = name.toLowerCase().trim();
    for (let [key, value] of Object.entries(stopDictionary)) {
        if (lower.includes(key)) {
            return value;
        }
    }
    if (name.length > 2) {
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return '';
}

async function processFiles() {
    console.log('=== НАЧАЛО ОБРАБОТКИ ===');
    const fileInput = document.getElementById('fileInput');
    const files = fileInput.files;
    console.log('Выбрано файлов:', files.length);
    
    if (files.length === 0) {
        showStatus('Выберите хотя бы один файл', 'error');
        return;
    }
    
    showStatus('Обработка файлов...', 'loading');
    scheduleData = [];
    allTrams.clear();
    
    for (let file of files) {
        console.log('Обработка файла:', file.name, 'Размер:', file.size, 'байт');
        try {
            if (file.name.match(/\.(xlsx|xls)$/i)) {
                await processExcelFile(file);
            } else if (file.name.match(/\.(jpg|jpeg|png)$/i)) {
                await processImageFile(file);
            } else {
                console.warn('Неподдерживаемый формат:', file.name);
            }
        } catch (error) {
            console.error('ОШИБКА обработки файла:', file.name, error);
            showStatus('Ошибка: ' + error.message, 'error');
        }
    }
    
    console.log('Всего записей после обработки:', scheduleData.length);
    
    if (scheduleData.length > 0) {
        showStatus('Успешно загружено: ' + scheduleData.length + ' записей | Вагонов: ' + allTrams.size, 'success');
        displayResults();
    } else {
        showStatus('Не удалось обработать файлы. Откройте консоль (F12) для деталей.', 'error');
    }
}

function processExcelFile(file) {
    return new Promise((resolve, reject) => {
        console.log('Начало чтения Excel файла:', file.name);
        const reader = new FileReader();
        
        reader.onload = function(e) {
            console.log('Файл загружен в память, размер:', e.target.result.byteLength, 'байт');
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                console.log('Excel файл распарсен успешно');
                console.log('Количество листов:', workbook.SheetNames.length);
                console.log('Названия листов:', workbook.SheetNames);
                
                workbook.SheetNames.forEach((sheetName, index) => {
                    console.log('\n>>> Обработка листа ' + (index + 1) + '/' + workbook.SheetNames.length + ': "' + sheetName + '"');
                    const sheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: '', raw: false});
                    console.log('Лист "' + sheetName + '" содержит ' + jsonData.length + ' строк');
                    parseScheduleData(jsonData, sheetName);
                });
                
                resolve();
            } catch (error) {
                console.error('ОШИБКА парсинга Excel:', error);
                reject(error);
            }
        };
        
        reader.onerror = function(error) {
            console.error('ОШИБКА чтения файла:', error);
            reject(error);
        };
        
        reader.readAsArrayBuffer(file);
    });
}

async function processImageFile(file) {
    showStatus('Распознавание текста из ' + file.name + '...', 'loading');
    console.log('Начало OCR для:', file.name);
    try {
        const result = await Tesseract.recognize(file, 'rus+eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    showStatus('Распознавание: ' + Math.round(m.progress * 100) + '%', 'loading');
                }
            }
        });
        const text = result.data.text;
        console.log('OCR завершён, распознано символов:', text.length);
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const tableData = lines.map(line => line.split(/\s{2,}|\t/).map(c => c.trim()).filter(c => c));
        parseScheduleData(tableData, file.name);
    } catch (error) {
        console.error('ОШИБКА OCR:', error);
        showStatus('Ошибка распознавания: ' + error.message, 'error');
    }
}

function parseScheduleData(data, fileName) {
    console.log('\n===========================================');
    console.log('ПАРСИНГ:', fileName);
    console.log('ВСЕГО СТРОК:', data.length);
    
    let routeNumber = '';
    let tripNumber = '';
    let headerRowIndex = -1;
    let stops = [];
    
    for (let i = 0; i < Math.min(20, data.length); i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        const rowText = row.join(' ');
        
        // Ищем "Маршрут 1" или "Расписание маршрута: 6"
        const routeMatch = rowText.match(/маршрут[:\s]*(\d+)/i);
        if (routeMatch) {
            routeNumber = routeMatch[1];
            console.log('✓ Найден маршрут: ' + routeNumber);
        }
        
        // Ищем "NZA 6-01"
        const tripMatch = rowText.match(/NZA\s*(\d+)-(\d+)/i);
        if (tripMatch) {
            routeNumber = tripMatch[1];
            tripNumber = tripMatch[2];
            console.log('✓ Найден NZA: маршрут ' + routeNumber + ', выезд ' + tripNumber);
        }
        
        // Ищем строку с остановками (содержит "Парк" или много ячеек с текстом)
        let textCellCount = 0;
        row.forEach(cell => {
            const cellStr = String(cell).trim();
            if (cellStr.length > 2 && !cellStr.match(/^\d/) && cellStr !== '.....') {
                textCellCount++;
            }
        });
        
        if (textCellCount >= 6 && headerRowIndex === -1) {
            headerRowIndex = i;
            stops = row.map(s => normalizeStopName(String(s).trim())).filter(s => s && s.length > 1);
            console.log('✓ НАЙДЕНА СТРОКА С ОСТАНОВКАМИ (строка ' + i + '), остановок: ' + stops.length);
            console.log('Остановки:', stops);
        }
    }
    
    if (!routeNumber) {
        console.warn('⚠ НЕ НАЙДЕН номер маршрута в ' + fileName);
        return;
    }
    if (headerRowIndex === -1) {
        console.error('✗ НЕ НАЙДЕНА строка с остановками в ' + fileName);
        return;
    }
    
    const tramId = routeNumber + '-' + (tripNumber || 'XX');
    console.log('ID вагона: ' + tramId);
    
    let tripCounter = 1;
    let totalRecords = 0;
    
    for (let i = headerRowIndex + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length < 2) continue;
        const rowText = row.join(' ').toLowerCase();
        
        if (rowText.includes('выезд') || rowText.includes('заезд') || 
            rowText.includes('начало') || rowText.includes('конец') ||
            rowText.includes('действительно') || rowText.includes('смена')) {
            continue;
        }
        
        const hasTime = row.some(cell => String(cell).match(/^\d{1,2}:\d{2}$/));
        if (!hasTime) continue;
        
        const isBreak = rowText.includes('обед');
        const times = [];
        
        row.forEach((cell, colIndex) => {
            const cellStr = String(cell).trim();
            if (cellStr.match(/^\d{1,2}:\d{2}$/)) {
                const stopIndex = Math.min(colIndex, stops.length - 1);
                if (stops[stopIndex]) {
                    times.push({
                        stop: stops[stopIndex],
                        time: cellStr,
                        colIndex: colIndex
                    });
                }
            }
        });
        
        if (times.length >= 3) {
            const firstCol = times[0].colIndex;
            const lastCol = times[times.length - 1].colIndex;
            const direction = firstCol < lastCol ? 'Прямое (А)' : 'Обратное (Б)';
            const tripId = tramId + '-trip' + tripCounter;
            
            times.forEach(t => {
                const timeObj = parseTime(t.time);
                if (timeObj && t.stop) {
                    scheduleData.push({
                        tramId: tramId,
                        routeNumber: routeNumber,
                        tripNumber: tripNumber,
                        tripId: tripId,
                        stop: t.stop,
                        time: timeObj,
                        timeStr: t.time,
                        direction: direction,
                        isBreak: isBreak,
                        source: fileName
                    });
                    totalRecords++;
                }
            });
            tripCounter++;
        }
    }
    
    console.log('✓ ИТОГО для ' + fileName + ': рейсов ' + (tripCounter - 1) + ', записей ' + totalRecords);
    
    if (totalRecords > 0) {
        allTrams.set(tramId, {
            route: routeNumber,
            trip: tripNumber,
            tripsCount: tripCounter - 1
        });
    }
}

function parseTime(timeStr) {
    if (!timeStr) return null;
    timeStr = String(timeStr).trim();
    const match = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (match) {
        return {
            hours: parseInt(match[1]),
            minutes: parseInt(match[2]),
            totalMinutes: parseInt(match[1]) * 60 + parseInt(match[2])
        };
    }
    return null;
}

function displayResults() {
    document.getElementById('resultsSection').style.display = 'block';
    
    // Сортируем вагоны по маршруту и номеру выезда
    const sortedTrams = Array.from(allTrams.entries()).sort((a, b) => {
        const routeA = parseInt(a[1].route) || 0;
        const routeB = parseInt(b[1].route) || 0;
        if (routeA !== routeB) return routeA - routeB;
        const tripA = parseInt(a[1].trip) || 0;
        const tripB = parseInt(b[1].trip) || 0;
        return tripA - tripB;
    });
    
    // Создаём вкладки по маршрутам
    let tabsHTML = '<div class="tabs-container">';
    tabsHTML += '<div class="tabs-header">';
    tabsHTML += '<button class="tab-btn active" onclick="filterByTram(\'\')">Все</button>';
    
    sortedTrams.forEach(([tramId, info]) => {
        tabsHTML += '<button class="tab-btn" onclick="filterByTram(\'' + tramId + '\')">М' + info.route + ' выезд ' + info.trip + '</button>';
    });
    tabsHTML += '</div></div>';
    
    // Статистика
    let statsHTML = '<div class="stats-box">';
    statsHTML += '<strong>📊 Статистика:</strong><br>';
    statsHTML += 'Всего маршрутов: ' + new Set(sortedTrams.map(t => t[1].route)).size + '<br>';
    statsHTML += 'Всего выездов: ' + allTrams.size + '<br>';
    statsHTML += 'Всего записей: ' + scheduleData.length + '<br><br>';
    statsHTML += '<strong>По маршрутам:</strong><br>';
    
    sortedTrams.forEach(([tramId, info]) => {
        statsHTML += 'Маршрут ' + info.route + ', выезд ' + info.trip + ': ' + info.tripsCount + ' рейсов<br>';
    });
    statsHTML += '</div>';
    
    // Таблица
    let tableHTML = '<table id="dataTable"><thead><tr><th>Маршрут</th><th>Выезд</th><th>Рейс</th><th>Остановка</th><th>Время</th><th>Направление</th></tr></thead><tbody>';
    
    scheduleData.sort((a, b) => {
        const routeA = parseInt(a.routeNumber) || 0;
        const routeB = parseInt(b.routeNumber) || 0;
        if (routeA !== routeB) return routeA - routeB;
        const tripA = parseInt(a.tripNumber) || 0;
        const tripB = parseInt(b.tripNumber) || 0;
        if (tripA !== tripB) return tripA - tripB;
        return a.time.totalMinutes - b.time.totalMinutes;
    }).forEach(record => {
        const tripNum = record.tripId.split('-trip')[1] || '-';
        const bgColor = record.isBreak ? ' class="break-row"' : '';
        tableHTML += '<tr' + bgColor + ' data-tram="' + record.tramId + '">';
        tableHTML += '<td>' + record.routeNumber + '</td>';
        tableHTML += '<td>' + record.tripNumber + '</td>';
        tableHTML += '<td>' + tripNum + '</td>';
        tableHTML += '<td>' + record.stop + '</td>';
        tableHTML += '<td>' + record.timeStr + '</td>';
        tableHTML += '<td>' + record.direction + '</td>';
        tableHTML += '</tr>';
    });
    tableHTML += '</tbody></table>';
    
    document.getElementById('tableContainer').innerHTML = tabsHTML + statsHTML + tableHTML;
    
    // Заполняем список остановок
    const stops = Array.from(new Set(scheduleData.map(r => r.stop))).sort();
    const stopSelect = document.getElementById('stopSelect');
    stopSelect.innerHTML = '<option value="">Все остановки</option>';
    stops.forEach(stop => {
        stopSelect.innerHTML += '<option value="' + stop + '">' + stop + '</option>';
    });
    
    updateVisualization();
}

function filterByTram(tramId) {
    // Обновляем активную вкладку
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Фильтруем таблицу
    const rows = document.querySelectorAll('#dataTable tbody tr');
    rows.forEach(row => {
        if (tramId === '' || row.dataset.tram === tramId) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
    
    // Обновляем визуализацию
    updateVisualization(tramId);
}

function updateVisualization(filterTramId) {
    const selectedStop = document.getElementById('stopSelect').value;
    const show4min = document.getElementById('show4min').checked;
    
    let filtered = scheduleData;
    
    // Фильтр по вагону (из вкладки)
    if (filterTramId) {
        filtered = filtered.filter(r => r.tramId === filterTramId);
    }
    
    // Фильтр по остановке
    if (selectedStop) {
        filtered = filtered.filter(r => r.stop === selectedStop);
    }
    
    filtered.sort((a, b) => a.time.totalMinutes - b.time.totalMinutes);
    
    let vizHTML = '';
    
    if (filtered.length === 0) {
        vizHTML = '<p>Нет данных для отображения. Выберите другой маршрут или остановку.</p>';
    } else {
        filtered.forEach((record) => {
            // Ищем ДРУГИЕ вагоны в пределах ±4 минуты на ТОЙ ЖЕ остановке
            let nearby = [];
            if (show4min && record.time) {
                nearby = scheduleData.filter(r => {
                    if (r.tramId === record.tramId) return false;
                    if (r.stop !== record.stop) return false;
                    if (!r.time) return false;
                    const diff = Math.abs(r.time.totalMinutes - record.time.totalMinutes);
                    return diff >= 0 && diff <= 4;
                });
            }
            
            const isHighlight = nearby.length > 0;
            const tripNum = record.tripId.split('-trip')[1] || '?';
            let cardClass = 'tram-card';
            if (isHighlight) cardClass += ' highlight';
            if (record.isBreak) cardClass += ' break';
            
            vizHTML += '<div class="' + cardClass + '">';
            vizHTML += '<div class="tram-header">';
            vizHTML += '<span class="tram-number">Маршрут ' + record.routeNumber + '</span>';
            vizHTML += '<span class="tram-trip">Выезд ' + record.tripNumber + ' | Рейс ' + tripNum + '</span>';
            vizHTML += '</div>';
            vizHTML += '<div class="tram-time">⏰ ' + record.timeStr + ' | 📍 ' + record.stop + ' | ➡️ ' + record.direction + '</div>';
            
            if (record.isBreak) {
                vizHTML += '<div class="break-label">☕ Обеденный рейс</div>';
            }
            
            if (nearby.length > 0) {
                vizHTML += '<div class="time-diff">⚠️ Рядом (±4 мин) на этой остановке:<br>';
                nearby.forEach(n => {
                    const diff = Math.abs(n.time.totalMinutes - record.time.totalMinutes);
                    vizHTML += '• Маршрут ' + n.routeNumber + ' выезд ' + n.tripNumber + ' в ' + n.timeStr + ' (разница: ' + diff + ' мин)<br>';
                });
                vizHTML += '</div>';
            }
            vizHTML += '</div>';
        });
    }
    
    document.getElementById('visualization').innerHTML = vizHTML;
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = 'status ' + type;
}
