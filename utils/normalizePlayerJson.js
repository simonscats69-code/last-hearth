// utils/normalizePlayerJson.js
// Единые парсеры/сериализаторы JSON-полей игрока (inventory, equipment, radiation).
'use strict';

const { safeJsonParse } = require('./serverApi');

function parseInventory(raw, fallback = []) {
    const value = safeJsonParse(raw, fallback);
    return Array.isArray(value) ? value : fallback;
}

function parseEquipment(raw, fallback = {}) {
    const value = safeJsonParse(raw, fallback);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function parseRadiation(raw, fallback = { level: 0, expires_at: null, applied_at: null }) {
    const value = safeJsonParse(raw, fallback);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function stringifyInventory(inventory) {
    return JSON.stringify(inventory ?? []);
}

function stringifyEquipment(equipment) {
    return JSON.stringify(equipment ?? {});
}

function stringifyRadiation(radiation) {
    return JSON.stringify(radiation ?? {});
}

module.exports = {
    parseInventory,
    parseEquipment,
    parseRadiation,
    stringifyInventory,
    stringifyEquipment,
    stringifyRadiation
};
