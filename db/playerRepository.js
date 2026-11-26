// db/playerRepository.js
// Единые операции обновления JSON-полей игрока (inventory, equipment, radiation).
'use strict';

const { query: defaultQuery } = require('./database');
const { requireId } = require('../utils/validate');
const { logger } = require('../utils/log');

function normalizeInventoryForStorage(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? parsed : []);
        } catch (e) {
            logger.warn({ type: 'invalid_inventory_storage', message: e.message });
            return [];
        }
    }
    if (typeof value === 'object') return value;
    return [];
}

function normalizeEquipmentForStorage(value) {
    if (value === null || value === undefined) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
        } catch (e) {
            logger.warn({ type: 'invalid_equipment_storage', message: e.message });
            return {};
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    return {};
}

function normalizeRadiationForStorage(value) {
    if (value === null || value === undefined) return { level: 0, expires_at: null, applied_at: null };
    if (typeof value === 'number') return { level: value, expires_at: null, applied_at: null };
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : { level: 0, expires_at: null, applied_at: null };
        } catch (e) {
            logger.warn({ type: 'invalid_radiation_storage', message: e.message });
            return { level: 0, expires_at: null, applied_at: null };
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    return { level: 0, expires_at: null, applied_at: null };
}

function getExecutor(client) {
    return client ? client.query.bind(client) : defaultQuery;
}

async function setPlayerInventory(playerId, inventory, client = null, options = {}) {
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);
    const jsonb = options.jsonb !== false;
    const payload = normalizeInventoryForStorage(inventory);
    const sql = jsonb
        ? 'UPDATE players SET inventory = $1::jsonb WHERE id = $2'
        : 'UPDATE players SET inventory = $1 WHERE id = $2';
    return exec(sql, [JSON.stringify(payload), playerId]);
}

async function setPlayerEquipment(playerId, equipment, client = null, options = {}) {
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);
    const jsonb = options.jsonb !== false;
    const payload = normalizeEquipmentForStorage(equipment);
    const sql = jsonb
        ? 'UPDATE players SET equipment = $1::jsonb WHERE id = $2'
        : 'UPDATE players SET equipment = $1 WHERE id = $2';
    return exec(sql, [JSON.stringify(payload), playerId]);
}

async function setPlayerRadiation(playerId, radiation, client = null, options = {}) {
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);
    const jsonb = options.jsonb !== false;
    const payload = normalizeRadiationForStorage(radiation);
    const sql = jsonb
        ? 'UPDATE players SET radiation = $1::jsonb WHERE id = $2'
        : 'UPDATE players SET radiation = $1 WHERE id = $2';
    return exec(sql, [JSON.stringify(payload), playerId]);
}

module.exports = {
    setPlayerInventory,
    setPlayerEquipment,
    setPlayerRadiation
};
