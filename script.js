let scheduleData = [];

async function processFiles() {
    const fileInput = document.getElementById('fileInput');
    const files = fileInput.files;
    
    if (files.length === 0) {
        showStatus('Выберите хотя бы один файл', 'error');
        return;
    }
    
    showStatus('Обработка файлов...', 'loading');
    scheduleData = [];
    
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
        showStatus(`Успешно загружено записей: ${scheduleData.length}`, 'success');
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
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, {header: 1});
                
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
    
    // Простой парсинг распознанного текста
    const lines = text.split('\n').filter(line => line.trim());
    const tableData = lines.map(line => line.split(/\s+/));
    
    parseScheduleData(tableData, file.name);
}

function parseScheduleData(data, fileName) {
    // Пропускаем заголовок (первая строка)
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        
        if (!row || row.length < 3) continue;
        
        // Автоматическое определение структуры:
        // Предполагаем: [Номер вагона, Остановка, Время, Направление]
        const record = {
            tramNumber: String(row[0] || '').trim(),
            stop: String(row[1] || '').trim(),
            time: parseTime(row[2]),
            direction: String(row[3] || 'A').trim(),
            source: fileName
        };
        
        if (record.tramNumber && record.stop && record.time) {
            scheduleData.push(record);
        }
    }
}

function parseTime(timeStr) {
    if (!timeStr) return null;
    
    timeStr = String(timeStr).trim();
    
    // Формат HH:MM
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
    let tableHTML = '<table><thead><tr><th>Номер вагона</th><th>Остановка</th><th>Время</th><th>Направление</th></tr></thead><tbody>';
    
    scheduleData.forEach(record => {
        const timeStr = record.time ? `${String(record.time.hours).padStart(2, '0')}:${String(record.time.minutes).padStart(2, '0')}` : '';
        tableHTML += `<tr>
            <td>${record.tramNumber}</td>
            <td>${record.stop}</td>
            <td>${timeStr}</td>
            <td>${record.direction}</td>
        </tr>`;
    });
    
    tableHTML += '</tbody></table>';
    document.getElementById('tableContainer').innerHTML = tableHTML;
    
    // Заполнить список остановок
    const stops = [...new Set(scheduleData.map(r => r.stop))];
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
    
    // Сортировка по времени
    filtered.sort((a, b) => (a.time?.totalMinutes || 0) - (b.time?.totalMinutes || 0));
    
    let vizHTML = '';
    
    filtered.forEach((record, index) => {
        const timeStr = record.time ? `${String(record.time.hours).padStart(2, '0')}:${String(record.time.minutes).padStart(2, '0')}` : '';
        
        // Поиск вагонов в пределах ±4 минуты
        let nearby = [];
        if (show4min && record.time) {
            nearby = filtered.filter(r => {
                if (r === record || !r.time) return false;
                const diff = Math.abs(r.time.totalMinutes - record.time.totalMinutes);
                return diff > 0 && diff <= 4;
            });
        }
        
        const isHighlight = nearby.length > 0;
        
        vizHTML += `
            <div class="tram-card ${isHighlight ? 'highlight' : ''}">
                <div class="tram-number">Вагон №${record.tramNumber}</div>
                <div class="tram-time">⏰ ${timeStr} | 📍 ${record.stop} | ➡️ ${record.direction}</div>
                ${nearby.length > 0 ? `<div class="time-diff">⚠️ Рядом (±4 мин): ${nearby.map(n => `№${n.tramNumber}`).join(', ')}</div>` : ''}
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
