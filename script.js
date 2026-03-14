let scheduleData = [];
let allTrams = new Map();

const stopDictionary = {
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
    
    if (files.length === 0) {
        showStatus('Выберите хотя бы один файл', 'error');
        return;
    }
    
    showStatus('Обработка файлов...', 'loading');
    scheduleData = [];
    allTrams.clear();
    
    for (let file of files) {
        try {
            if (file.name.match(/\.(xlsx|xls)$/i)) {
                await processExcelFile(file);
            }
        } catch (error) {
            console.error('ОШИБКА обработки файла:', file.name, error);
            showStatus('Ошибка: ' + error.message, 'error');
        }
    }
    
    if (scheduleData.length > 0) {
        showStatus('Успешно загружено: ' + scheduleData.length + ' записей | Выездов: ' + allTrams.size, 'success');
        displayResults();
    } else {
        showStatus('Не удалось обработать файлы. Откройте консоль (F12) для деталей.', 'error');
    }
}

function processExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                console.log('Листов в файле:', workbook.SheetNames.length);
                
                workbook.SheetNames.forEach((sheetName, index) => {
                    console.log('\n>>> Лист ' + (index + 1) + ': "' + sheetName + '"');
                    const sheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: '', raw: false});
                    parseScheduleData(jsonData, sheetName);
                });
                
                resolve();
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function parseScheduleData(data, sheetName) {
    console.log('=== ПАРСИНГ: ' + sheetName + ' ===');
    
    let routeNumber = '';
    let tripNumber = '';
    let headerRowIndex = -1;
    let stops = [];
    
    // Ищем NZA X-XX в первых 15 строках — это главный источник маршрута и выезда
    for (let i = 0; i < Math.min(15, data.length); i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        
        for (let j = 0; j < row.length; j++) {
            const cellText = String(row[j]).trim();
            
            // Ищем NZA 6-01, NZA 1-02 и т.д.
            const nzaMatch = cellText.match(/NZA\s*(\d+)-(\d+)/i);
            if (nzaMatch) {
                routeNumber = nzaMatch[1];
                tripNumber = nzaMatch[2];
                console.log('✓ Найден NZA: маршрут ' + routeNumber + ', выезд ' + tripNumber);
                break;
            }
        }
        if (routeNumber) break;
    }
    
    // Если NZA не найден, ищем "Расписание маршрута: X"
    if (!routeNumber) {
        for (let i = 0; i < Math.min(15, data.length); i++) {
            const row = data[i];
            if (!row || row.length === 0) continue;
            const rowText = row.join(' ');
            
            const routeMatch = rowText.match(/маршрут[:\s]*(\d+)/i);
            if (routeMatch) {
                routeNumber = routeMatch[1];
                tripNumber = '01';
                console.log('✓ Найден маршрут из текста: ' + routeNumber);
                break;
            }
        }
    }
    
    // Ищем строку с остановками
    for (let i = 0; i < Math.min(20, data.length); i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        
        let textCellCount = 0;
        row.forEach(cell => {
            const cellStr = String(cell).trim();
            if (cellStr.length > 2 && !cellStr.match(/^\d/) && cellStr !== '.....' && cellStr !== 'NZA') {
                textCellCount++;
            }
        });
        
        if (textCellCount >= 6) {
            headerRowIndex = i;
            stops = row.map(s => normalizeStopName(String(s).trim())).filter(s => s && s.length > 1);
            console.log('✓ Остановки (строка ' + i + '): ' + stops.length + ' шт.');
            break;
        }
    }
    
    if (!routeNumber) {
        console.warn('⚠ НЕ НАЙДЕН номер маршрута в ' + sheetName);
        return;
    }
    if (headerRowIndex === -1) {
        console.error('✗ НЕ НАЙДЕНА строка с остановками в ' + sheetName);
        return;
    }
    
    const tramId = routeNumber + '-' + tripNumber;
    console.log('ID: ' + tramId);
    
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
            
            times.forEach(t => {
                const timeObj = parseTime(t.time);
                if (timeObj && t.stop) {
                    scheduleData.push({
                        tramId: tramId,
                        routeNumber: routeNumber,
                        tripNumber: tripNumber,
                        stop: t.stop,
                        time: timeObj,
                        timeStr: t.time,
                        direction: direction,
                        isBreak: isBreak
                    });
                    totalRecords++;
                }
            });
        }
    }
    
    console.log('✓ Записей: ' + totalRecords);
    
    if (totalRecords > 0) {
        if (!allTrams.has(tramId)) {
            allTrams.set(tramId, {
                route: routeNumber,
                trip: tripNumber,
                recordsCount: totalRecords
            });
        } else {
            allTrams.get(tramId).recordsCount += totalRecords;
        }
    }
}

function parseTime(timeStr) {
    if (!timeStr) return null;
    const match = String(timeStr).trim().match(/(\d{1,2}):(\d{2})/);
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
    
    const sortedTrams = Array.from(allTrams.entries()).sort((a, b) => {
        const routeA = parseInt(a[1].route) || 0;
        const routeB = parseInt(b[1].route) || 0;
        if (routeA !== routeB) return routeA - routeB;
        const tripA = parseInt(a[1].trip) || 0;
        const tripB = parseInt(b[1].trip) || 0;
        return tripA - tripB;
    });
    
    // Вкладки
    let tabsHTML = '<div class="tabs-container"><div class="tabs-header">';
    tabsHTML += '<button class="tab-btn active" onclick="filterByTram(\'\')">Все</button>';
    sortedTrams.forEach(([tramId, info]) => {
        tabsHTML += '<button class="tab-btn" onclick="filterByTram(\'' + tramId + '\')">М' + info.route + ' вых.' + info.trip + '</button>';
    });
    tabsHTML += '</div></div>';
    
    // Статистика
    let statsHTML = '<div class="stats-box">';
    statsHTML += '<strong>📊 Загружено:</strong> ';
    statsHTML += 'Маршрутов: ' + new Set(sortedTrams.map(t => t[1].route)).size + ' | ';
    statsHTML += 'Выездов: ' + allTrams.size + ' | ';
    statsHTML += 'Записей: ' + scheduleData.length;
    statsHTML += '</div>';
    
    // Таблица
    let tableHTML = '<table id="dataTable"><thead><tr><th>Маршрут</th><th>Выезд</th><th>Остановка</th><th>Время</th><th>Направление</th></tr></thead><tbody>';
    
    scheduleData.sort((a, b) => {
        const routeA = parseInt(a.routeNumber) || 0;
        const routeB = parseInt(b.routeNumber) || 0;
        if (routeA !== routeB) return routeA - routeB;
        const tripA = parseInt(a.tripNumber) || 0;
        const tripB = parseInt(b.tripNumber) || 0;
        if (tripA !== tripB) return tripA - tripB;
        return a.time.totalMinutes - b.time.totalMinutes;
    }).forEach(record => {
        const bgColor = record.isBreak ? ' class="break-row"' : '';
        tableHTML += '<tr' + bgColor + ' data-tram="' + record.tramId + '">';
        tableHTML += '<td>' + record.routeNumber + '</td>';
        tableHTML += '<td>' + record.tripNumber + '</td>';
        tableHTML += '<td>' + record.stop + '</td>';
        tableHTML += '<td>' + record.timeStr + '</td>';
        tableHTML += '<td>' + record.direction + '</td>';
        tableHTML += '</tr>';
    });
    tableHTML += '</tbody></table>';
    
    document.getElementById('tableContainer').innerHTML = tabsHTML + statsHTML + tableHTML;
    
    const stops = Array.from(new Set(scheduleData.map(r => r.stop))).sort();
    const stopSelect = document.getElementById('stopSelect');
    stopSelect.innerHTML = '<option value="">Все остановки</option>';
    stops.forEach(stop => {
        stopSelect.innerHTML += '<option value="' + stop + '">' + stop + '</option>';
    });
    
    updateVisualization();
}

function filterByTram(tramId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    const rows = document.querySelectorAll('#dataTable tbody tr');
    rows.forEach(row => {
        if (tramId === '' || row.dataset.tram === tramId) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
    
    updateVisualization(tramId);
}

function updateVisualization(filterTramId) {
    const selectedStop = document.getElementById('stopSelect').value;
    const show4min = document.getElementById('show4min').checked;
    
    let filtered = scheduleData;
    
    if (filterTramId) {
        filtered = filtered.filter(r => r.tramId === filterTramId);
    }
    if (selectedStop) {
        filtered = filtered.filter(r => r.stop === selectedStop);
    }
    
    filtered.sort((a, b) => a.time.totalMinutes - b.time.totalMinutes);
    
    let vizHTML = '';
    
    if (filtered.length === 0) {
        vizHTML = '<p>Нет данных для отображения.</p>';
    } else {
        filtered.forEach((record) => {
            let nearby = [];
            if (show4min && record.time) {
                nearby = scheduleData.filter(r => {
                    if (r.tramId === record.tramId) return false;
                    if (r.stop !== record.stop) return false;
                    if (!r.time) return false;
                    const diff = Math.abs(r.time.totalMinutes - record.time.totalMinutes);
                    return diff <= 4;
                });
            }
            
            const isHighlight = nearby.length > 0;
            let cardClass = 'tram-card';
            if (isHighlight) cardClass += ' highlight';
            if (record.isBreak) cardClass += ' break';
            
            vizHTML += '<div class="' + cardClass + '">';
            vizHTML += '<div class="tram-header">';
            vizHTML += '<span class="tram-number">Маршрут ' + record.routeNumber + '</span>';
            vizHTML += '<span class="tram-trip">Выезд ' + record.tripNumber + '</span>';
            vizHTML += '</div>';
            vizHTML += '<div class="tram-time">⏰ ' + record.timeStr + ' | 📍 ' + record.stop + ' | ➡️ ' + record.direction + '</div>';
            
            if (record.isBreak) {
                vizHTML += '<div class="break-label">☕ Обед</div>';
            }
            
            if (nearby.length > 0) {
                vizHTML += '<div class="time-diff">⚠️ Рядом (±4 мин):<br>';
                nearby.forEach(n => {
                    const diff = Math.abs(n.time.totalMinutes - record.time.totalMinutes);
                    vizHTML += '• М' + n.routeNumber + ' вых.' + n.tripNumber + ' в ' + n.timeStr + ' (' + diff + ' мин)<br>';
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
