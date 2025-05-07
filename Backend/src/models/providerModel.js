const providers = new Map(); // Map<ws, { id, lastSeen, cids }>

function set(ws, info) {
    providers.set(ws, info);
}

function getAll() {
    return providers;
}

function remove(ws) {
    providers.delete(ws);
}

export default {
    set,
    getAll,
    delete: remove
};