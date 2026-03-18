/**
 * Вспомогательные функции для нормализации состояния игрока.
 * Используются и на сервере, и как единый источник правил для статуса.
 */

const ENERGY_REGEN_INTERVAL_MS = 60 * 1000;

function safeParseJson(value, fallback) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    if (typeof value === 'object') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizeInventory(value) {
    const parsed = safeParseJson(value, []);

    if (Array.isArray(parsed)) {
        return parsed;
    }

    if (parsed && typeof parsed === 'object') {
        return Object.values(parsed).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    }

    return [];
}

function normalizeRadiation(value) {
    const parsed = safeParseJson(value, { level: 0 });

    if (typeof parsed === 'number') {
        return {
            level: parsed,
            expires_at: null,
            applied_at: null
        };
    }

    if (parsed && typeof parsed === 'object') {
        return {
            level: Number(parsed.level || 0),
            expires_at: parsed.expires_at || null,
            applied_at: parsed.applied_at || null
        };
    }

    return {
        level: 0,
        expires_at: null,
        applied_at: null
    };
}

function normalizeInfections(value) {
    const parsed = safeParseJson(value, []);
    return Array.isArray(parsed) ? parsed : [];
}

function getInfectionLevel(value) {
    return normalizeInfections(value).reduce((sum, infection) => sum + (infection.level || 0), 0);
}

function buildPlayerStatus(player) {
    const radiation = normalizeRadiation(player.radiation);
    const infectionsList = normalizeInfections(player.infections);

    return {
        health: Number(player.health || 0),
        max_health: Number(player.max_health || 0),
        radiation: radiation.level,
        fatigue: Number(player.fatigue || 0),
        energy: Number(player.energy || 0),
        max_energy: Number(player.max_energy || 0),
        infections: infectionsList.reduce((sum, infection) => sum + (infection.level || 0), 0),
        infections_list: infectionsList,
        last_energy_update: player.last_energy_update || null
    };
}

module.exports = {
    ENERGY_REGEN_INTERVAL_MS,
    safeParseJson,
    normalizeInventory,
    normalizeRadiation,
    normalizeInfections,
    getInfectionLevel,
    buildPlayerStatus
};
