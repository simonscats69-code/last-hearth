/**
 * Метрики сервера: счётчики HTTP-запросов, времена ответа и загрузка системы.
 * Данные отдаёт админский эндпоинт GET /metrics (см. index.js).
 *
 * Модуль намеренно НЕ импортирует logger из serverApi: раньше здесь жил
 * WebSocket-сервер, который тянул logger за собой, и serverApi приходилось
 * грузить этот файл лениво внутри try/catch, чтобы разорвать цикл
 * serverApi <-> realtime. Сейчас цикла нет — импорт обычный.
 */

const os = require('os');

const metrics = {
    requests: {
        total: 0,
        success: 0,
        errors: 0,
        byEndpoint: Object.create(null)
    },
    responseTimes: [],
    startTime: Date.now()
};

const MAX_ENDPOINTS = 1000;

function recordRequest(endpoint, statusCode, responseTime) {
    metrics.requests.total++;

    const isSuccess = statusCode >= 200 && statusCode < 400;
    if (isSuccess) {
        metrics.requests.success++;
    } else {
        metrics.requests.errors++;
    }

    if (!metrics.requests.byEndpoint[endpoint]) {
        if (Object.keys(metrics.requests.byEndpoint).length >= MAX_ENDPOINTS) {
            // evict oldest? simple: skip new endpoint tracking
        } else {
            metrics.requests.byEndpoint[endpoint] = {
                total: 0,
                success: 0,
                errors: 0,
                avgTime: 0
            };
        }
    }

    const ep = metrics.requests.byEndpoint[endpoint];
    if (ep) {
        ep.total++;
        if (isSuccess) {
            ep.success++;
        } else {
            ep.errors++;
        }
        const rt = Number.isFinite(responseTime) ? responseTime : 0;
        ep.avgTime = Math.round((((ep.avgTime * (ep.total - 1)) + rt) / ep.total) * 100) / 100;
    }

    const rt2 = Number.isFinite(responseTime) ? responseTime : 0;
    metrics.responseTimes.push(rt2);
    if (metrics.responseTimes.length > 100) {
        metrics.responseTimes.shift();
    }
}

/**
 * Получить текущие метрики
 */
function getMetrics() {
    const uptime = Date.now() - metrics.startTime;
    const avgResponseTime = metrics.responseTimes.length > 0
        ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
        : 0;

    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    cpus.forEach(cpu => {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    });
    const cpuUsage = totalTick > 0 ? 100 - (100 * totalIdle / totalTick) : 0;

    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    const endpointsSnapshot = {};
    for (const key of Object.keys(metrics.requests.byEndpoint)) {
        endpointsSnapshot[key] = { ...metrics.requests.byEndpoint[key] };
    }

    return {
        uptime: Math.floor(uptime / 1000),
        requests: {
            total: metrics.requests.total,
            success: metrics.requests.success,
            errors: metrics.requests.errors,
            successRate: metrics.requests.total > 0
                ? Math.round((metrics.requests.success / metrics.requests.total) * 100)
                : 0
        },
        performance: {
            avgResponseTime: Math.round(avgResponseTime * 100) / 100,
            requestsPerSecond: uptime > 0 ? Number((metrics.requests.total / (uptime / 1000)).toFixed(2)) : 0
        },
        system: {
            cpu: Math.round(cpuUsage * 100) / 100,
            memory: {
                used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                systemTotal: Math.round(totalMemory / 1024 / 1024),
                systemFree: Math.round(freeMemory / 1024 / 1024)
            },
            nodeVersion: process.version,
            platform: os.platform()
        },
        endpoints: endpointsSnapshot
    };
}

module.exports = {
    recordRequest,
    getMetrics
};