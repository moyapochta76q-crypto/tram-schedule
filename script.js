let scheduleData = [];
let allTrams = new Map(); // tramId -> {route, trip, times}

async function processFiles() {
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
            } else if (file.name.match(/\.(jpg|jpeg|png)$/i)) {
                await processImageFile(file);
            }
        } catch (error) {
            console.error('Ошибка обработки файла:', file.name, error);
        }
    }
    
    if (scheduleData.length > 0) {
        showStatus(`Успешно загружено: ${scheduleData.length} записей | Вагонов: ${allTrams.size}`, 'success');
        displayResults();
    } else {
        showStatus('Не удалось обработать файлы. Проверьте формат данных.', 'error');
    }
}

function processExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, {header: 1, defval: ''});
                
                parseScheduleData(jsonData, file.name);
                resolve();
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

async function processImageFile(file) {
    showStatus(`Распознавание текста из ${file.name}...`, 'loading');
    
    const { data: { text } } = await Tesseract.recognize(file, 'rus', {
        logger: m => console.log(m)
    });
    
    const lines = text.split('\n').filter(line => line.trim());
    const tableData = lines.map(line => line.split(/\s+/));
    
    parseScheduleData(tableData, file.name);
}

function parseScheduleData(data, fileName) {
    let routeNumber = '';
    let tripNumber = '';
    let headerRowIndex = -1;
    let stops = [];
    
    // Поиск маршрута и выезда
    for (let i = 0; i < Math.min(15, data.length); i++) {
        const row = data[i];
        if (!row) continue;
        
        const rowText = row.join(' ');
        
        // Ищем "Расписание маршрута: 6"
        const routeMatch = rowText.match(/маршрут[:\s]*(\d+)/i);
        if (routeMatch) {
            routeNumber = routeMatch[1];
        }
        
        // Ищем "NZA 6-01" (6-01 это маршрут-выезд)
        const tripMatch = rowText.match(/NZA\s*(\d+)-(\d+)/i);
        if (tripMatch) {
            routeNumber = tripMatch[1];
            tripNumber = tripMatch[2];
        }
        
        // Ищем строку с остановками (содержит несколько остановок подряд)
        const stopKeywords = ['парк', 'серебрянка', 'поликлиника', 'партизанская', 'уральская', 'бядули', 'волгоградская', 'зелёный'];
        let stopCount = 0;
        row.forEach(cell => {
            const cellLower = String(cell).toLowerCase();
            if (stopKeywords.some(kw => cellLower.includes(kw))) {
                stopCount++;
            }
        });
        
        if (stopCount >= 5) {
            headerRowIndex = i;
            stops = row.map(s => String(s).trim()).filter(s => s && s !== '.....' && s.length > 1);
            break;
        }
    }
    
    if (!routeNumber || headerRowIndex === -1) {
        console.warn('Не удалось найти маршрут или заголовок в файле:', fileName);
        return;
    }
    
    const tramId = `${routeNumber}-${tripNumber || '??'}`;
    
    console.log(`Обработка: Маршрут ${routeNumber}, Выезд ${tripNumber}, Остановок: ${stops.length}`);
    
    // Парсим рейсы (строки после заголовка)
    let tripCounter = 1;
    
    for (let i = headerRowIndex + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length < 2) continue;
        
        const rowText = row.join(' ').toLowerCase();
        
        // Пропускаем служебные строки
        if (rowText.includes('выезд') || rowText.includes('заезд') || 
            rowText.includes('начало') || rowText.includes('конец') ||
            rowText.includes('действительно')) {
            continue;
        }
        
        // Пропускаем пустые строки
        const hasTime = row.some(cell => String(cell).match(/^\d{1,2}:\d{2}$/));
        if (!hasTime) continue;
        
        // Определяем обед
        const isBreak = rowText.includes('обед');
        
        // Извлекаем времена и их позиции
        const times = [];
        row.forEach((cell, colIndex) => {
            const cellStr = String(cell).trim();
            if (cellStr.match(/^\d{1,2}:\d{2}$/)) {
                // Находим соответствующую остановку
                // Колонки могут не совпадать 1-в-1, ищем ближайшую
                const stopIndex = Math.min(colIndex, stops.length - 1);
                
                times.push({
                    stop: stops[stopIndex],
                    time: cellStr,
                    colIndex: colIndex
                });
            }
        });
        
        // Если найдено хотя бы 3 времени - это рейс
        if (times.length >= 3) {
            // Определяем направление
            const firstCol = times[0].colIndex;
            const lastCol = times[times.length - 1].colIndex;
            const direction = firstCol < lastCol ? 'Прямое (А)' : 'Обратное (Б)';
            
            const tripId = `${tramId}-trip${tripCounter}`;
            tripCounter++;
            
            // Записываем каждую остановку рейса
            times.forEach(t => {
                const timeObj = parseTime(t.time);
                if (timeObj) {
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
                }
            });
            
            if (!allTrams.has(tramId)) {
                allTrams.set(tramId, {
                    route: routeNumber,
                    trip: tripNumber,
                    tripsCount: 0
                });
            }
            allTrams.get(tramId).tripsCount++;
        }
    }
    
    console.log(`Загружено рейсов: ${tripCounter - 1}`);
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
    
    // Таблица данных
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
    
    // Заполнить список остановок
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
        // Поиск ДРУГИХ вагонов в пределах ±4 минуты
        let nearby = [];
        if (show4min && record.time) {
            nearby = filtered.filter(r => {
                // Исключаем тот же самый вагон
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
