let scheduleData = [];
let allTrams = new Map();

// Словарь для исправления распознанных остановок
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
    'парк': 'Парк'
};

function normalizeStopName(name) {
    if (!name) return '';
    const lower = name.toLowerCase().trim();
    
    for (let [key, value] of Object.entries(stopDictionary)) {
        if (lower.includes(key)) {
            return value;
        }
    }
    
    return name.charAt(0).toUpperCase() + name.slice(1);
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
            showStatus(`Ошибка: ${error.message}`, 'error');
        }
    }
    
    console.log('Всего записей после обработки:', scheduleData.length);
    
    if (scheduleData.length > 0) {
        showStatus(`Успешно загружено: ${scheduleData.length} записей | Вагонов: ${allTrams.size}`, 'success');
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
                
                // Обрабатываем ВСЕ листы
                workbook.SheetNames.forEach((sheetName, index) => {
                    console.log(`\n>>> Обработка листа ${index + 1}/${workbook.SheetNames.length}: "${sheetName}"`);
                    
                    const sheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: '', raw: false});
                    
                    console.log(`Лист "${sheetName}" содержит ${jsonData.length} строк`);
                    
                    parseScheduleData(jsonData, `${file.name} [${sheetName}]`);
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
    showStatus(`Распознавание текста из ${file.name}...`, 'loading');
    console.log('Начало OCR для:', file.name);
    
    try {
        const { data: { text } } = await Tesseract.recognize(file, 'rus+eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    showStatus(`Распознавание: ${Math.round(m.progress * 100)}%`, 'loading');
                }
                console.log('OCR прогресс:', m);
            }
        });
        
        console.log('OCR завершён, распознано символов:', text.length);
        console.log('Распознанный текст:', text);
        
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const tableData = lines.map(line => line.split(/\s{2,}|\t/).map(c => c.trim()).filter(c => c));
        
        parseScheduleData(tableData, file.name);
        
    } catch (error) {
        console.error('ОШИБКА OCR:', error);
        showStatus(`Ошибка распознавания: ${error.message}`, 'error');
    }
}

function parseScheduleData(data, fileName) {
    console.log('\n===========================================');
    console.log('ПАРСИНГ ФАЙЛА:', fileName);
    console.log('ВСЕГО СТРОК:', data.length);
    console.log('ПЕРВЫЕ 25 СТРОК:');
    
    data.slice(0, 25).forEach((row, i) => {
        console.log(`Строка ${i}:`, row);
    });
    
    console.log('===========================================\n');
    
    let routeNumber = '';
    let tripNumber = '';
    let headerRowIndex = -1;
    let stops = [];
    
    // Поиск маршрута и выезда
    for (let i = 0; i < Math.min(20, data.length); i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        
        const rowText = row.join(' ');
        console.log(`Анализ строки ${i}: "${rowText}"`);
        
        // Ищем "Маршрут 1" или "Расписание маршрута: 6"
        const routeMatch = rowText.match(/маршрут[:\s]*(\d+)/i);
        if (routeMatch) {
            routeNumber = routeMatch[1];
            console.log(`✓ Найден маршрут: ${routeNumber}`);
        }
        
        // Ищем "NZA 6-01"
        const tripMatch = rowText.match(/NZA\s*(\d+)-(\d+)/i);
        if (tripMatch) {
            routeNumber = tripMatch[1];
            tripNumber = tripMatch[2];
            console.log(`✓ Найден NZA: маршрут ${routeNumber}, выезд ${tripNumber}`);
        }
        
        // Ищем строку с остановками
        const stopKeywords = ['парк', 'серебрянка', 'поликлиника', 'партизанская', 'уральская', 'бядули', 'волгоградская', 'зелёный', 'зеленый'];
        let stopCount = 0;
        
        row.forEach(cell => {
            const cellLower = String(cell).toLowerCase();
            if (stopKeywords.some(kw => cellLower.includes(kw))) {
                stopCount++;
            }
        });
        
        if (stopCount >= 4) {
            headerRowIndex = i;
            stops = row.map(s => normalizeStopName(String(s).trim())).filter(s => s && s !== '.....' && s.length > 1);
            console.log(`✓ НАЙДЕНА СТРОКА С ОСТАНОВКАМИ (строка ${i}), остановок: ${stops.length}`);
            console.log('Остановки:', stops);
            break;
        }
    }
    
    if (!routeNumber) {
        console.warn('⚠ НЕ НАЙДЕН номер маршрута');
    }
    
    if (headerRowIndex === -1) {
        console.error('✗ НЕ НАЙДЕНА строка с остановками!');
        return;
    }
    
    const tramId = `${routeNumber}-${tripNumber || 'XX'}`;
    console.log(`\nID вагона: ${tramId}`);
    console.log(`Начинаем парсить рейсы с строки ${headerRowIndex + 1}...\n`);
    
    let tripCounter = 1;
    let totalRecords = 0;
    
    // Парсим рейсы
    for (let i = headerRowIndex + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length < 2) continue;
        
        const rowText = row.join(' ').toLowerCase();
        
        // Пропускаем служебные строки
        if (rowText.includes('выезд') || rowText.includes('заезд') || 
            rowText.includes('начало') || rowText.includes('конец') ||
            rowText.includes('действительно') || rowText.includes('смена')) {
            console.log(`Пропуск служебной строки ${i}: ${rowText.substring(0, 50)}`);
            continue;
        }
        
        // Проверяем наличие времени
        const hasTime = row.some(cell => String(cell).match(/^\d{1,2}:\d{2}$/));
        if (!hasTime) continue;
        
        const isBreak = rowText.includes('обед');
        
        // Извлекаем времена
        const times = [];
        row.forEach((cell, colIndex) => {
            const cellStr = String(cell).trim();
            if (cellStr.match(/^\d{1,2}:\d{2}$/)) {
                const stopIndex = Math.min(colIndex, stops.length - 1);
                times.push({
                    stop: stops[stopIndex],
                    time: cellStr,
                    colIndex: colIndex
                });
            }
        });
        
        if (times.length >= 3) {
            const firstCol = times[0].colIndex;
            const lastCol = times[times.length - 1].colIndex;
            const direction = firstCol < lastCol ? 'Прямое (А)' : 'Обратное (Б)';
            
            const tripId = `${tramId}-trip${tripCounter}`;
            
            console.log(`Рейс ${tripCounter}: ${times.length} остановок, направление: ${direction}`);
            
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
    
    console.log(`\n✓ ИТОГО для ${fileName}:`);
    console.log(`  Рейсов: ${tripCounter - 1}`);
    console.log(`  Записей: ${totalRecords}`);
    
    if (!allTrams.has(tramId)) {
        allTrams.set(tramId, {
            route: routeNumber,
            trip: tripNumber,
            tripsCount: 0
        });
    }
    allTrams.get(tramId).tripsCount = tripCounter - 1;
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
    
    let tableHTML = `
        <div style="margin-bottom: 20px; padding: 15px; background: #e7f3ff; border-radius: 5px;">
            <strong>Загружено вагонов:</strong> ${allTrams.size}<br>
            ${Array.from(allTrams.entries()).map(([id, info]) => 
                `Маршрут ${info.route}, выезд ${info.trip}: ${info.tripsCount} рейсов`
            ).join('<br>')}
        </div>
    `;
    
    tableHTML += '<table><thead><tr><th>Вагон</th><th>Рейс</th><th>Остановка</th><th>Время</th><th>Направление</th></tr></thead><tbody>';
    
    scheduleData
        .sort((a, b) => {
            if (a.tramId !== b.tramId) return a.tramId.localeCompare(b.tramId);
            return a.time.totalMinutes - b.time.totalMinutes;
        })
        .forEach(record => {
            tableHTML += `<tr ${record.isBreak ? 'style="background:#fff3cd;"' : ''}>
                <td>${record.tramId}</td>
                <td>${record.tripId.split('-trip')[1] || '-'}</td>
                <td>${record.stop}</td>
                <td>${record.timeStr}</td>
                <td>${record.direction}</td>
            </tr>`;
        });
    
    tableHTML += '</tbody></table>';
    document.getElementById('tableContainer').innerHTML = tableHTML;
    
    const stops = [...new Set(scheduleData.map(r => r.stop))].sort();
    const stopSelect = document.getElementById('stopSelect');
    stopSelect.innerHTML = '<option value="">Все остановки</option>';
    stops.forEach(stop => {
        stopSelect.innerHTML += `<option value="${stop}">${stop}</option>`;
    });
    
    updateVisualization();
}

function updateVisualization() {
    const selectedStop = document.getElementById('stopSelect').value;
    const show4min = document.getElementById('show4min').checked;
    
    let filtered = scheduleData;
    if (selectedStop) {
        filtered = scheduleData.filter(r => r.stop === selectedStop);
    }
    
    filtered.sort((a, b) => a.time.totalMinutes - b.time.totalMinutes);
    
    let vizHTML = '';
    
    filtered.forEach((record, index) => {
        let nearby = [];
        if (show4min && record.time) {
            nearby = filtered.filter(r => {
                if (r.tramId === record.tramId) return false;
                if (!r.time) return false;
                
                const diff = Math.abs(r.time.totalMinutes - record.time.totalMinutes);
                return diff >= 0 && diff <= 4;
            });
        }
        
        const isHighlight = nearby.length > 0;
        
        vizHTML += `
            <div class="tram-card ${isHighlight ? 'highlight' : ''} ${record.isBreak ? 'break' : ''}">
                <div class="tram-number">Вагон ${record.tramId} (Рейс №${record.tripId.split('-trip')[1] || '?'})</div>
                <div class="tram-time">
                    ⏰ ${record.timeStr} | 
                    📍 ${record.stop} | 
                    ➡️ ${record.direction}
                </div>
                ${record.isBreak ? '<div style="color:#856404; font-size:12px;">☕ Обеденный рейс</div>' : ''}
                ${nearby.length > 0 ? `
                    <div class="time-diff">
                        ⚠️ Рядом (±4 мин):<br>
                        ${nearby.map(n => `• Вагон ${n.tramId} в ${n.timeStr} (разница: ${Math.abs(n.time.totalMinutes - record.time.totalMinutes)} мин)`).join('<br>')}
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    document.getElementById('visualization').innerHTML = vizHTML || '<p>Нет данных для отображения</p>';
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
}
