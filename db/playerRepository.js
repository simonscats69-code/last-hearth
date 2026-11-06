// db/playerRepository.js
// Единые операции обновления JSON-полей игрока (inventory, equipment, radiation).
'use strict';

const { query: defaultQuery } = require('./database');
const { requireId } = require('../utils/validate');

function getExecutor(client) {
    return client ? client.query.bind(client) : defaultQuery;
}

async function setPlayerInventory(playerId, inventory, client = null, options = {}) {
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);
    const jsonb = options.jsonb !== false;
    const sql = jsonb
        ? 'UPDATE players SET inventory = $1::jsonb WHERE id = $2'
        : 'UPDATE players SET inventory = $1 WHERE id = $2';
    return exec(sql, [JSON.stringify(inventory), playerId]);
}

async function setPlayerEquipment(playerId, equipment, client = null, options = {}) {
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);
    const jsonb = options.jsonb !== false;
    const sql = jsonb
        ? 'UPDATE players SET equipment = $1::jsonb WHERE id = $2'
        : 'UPDATE players SET equipment = $1 WHERE id = $2';
    return exec(sql, [JSON.stringify(equipment), playerId]);
}

async function setPlayerRadiation(playerId, radiation, client = null, options = {}) {
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);
    const jsonb = options.jsonb !== false;
    const sql = jsonb
        ? 'UPDATE players SET radiation = $1::jsonb WHERE id = $2'
        : 'UPDATE players SET radiation = $1 WHERE id = $2';
    return exec(sql, [JSON.stringify(radiation), playerId]);
}

module.exports = {
    setPlayerInventory,
    setPlayerEquipment,
    setPlayerRadiation
};
