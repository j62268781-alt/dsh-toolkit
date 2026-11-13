/** Offline JSON-safe patch conversion. No profile or runtime state is accessed. */
export const ROOT_IDS = ['shell-kit', 'dsh-toolkit', 'dsh-shell-kit'];
export const MODULE_NAMESPACES = Object.freeze({
    boot: 'boot', theme: 'theme', archived: 'archived', browser: 'browser',
    judgement: 'judgment', mobile: 'mobile', skillsMcp: 'skills-mcp', notification: 'notification', pet: 'pet',
});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function validate(value, path = 'patch') {
    if (value === null || ['string', 'boolean'].includes(typeof value))
        return;
    if (typeof value === 'number' && Number.isFinite(value))
        return;
    if (Array.isArray(value))
        return value.forEach((item, index) => validate(item, `${path}[${index}]`));
    if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw new TypeError(`${path}: expected JSON-safe plain data`);
    for (const [key, item] of Object.entries(value)) {
        if (key === '__jsExpr' || key === '__proto__')
            throw new TypeError(`${path}.${key}: expressions and prototype keys cannot be migrated safely`);
        validate(item, `${path}.${key}`);
    }
}
/** Existing module values win recursively; arrays and scalar values replace whole values. */
function merge(defaults, existing) {
    if (!object(defaults) || !object(existing))
        return structuredClone(existing);
    const result = structuredClone(defaults);
    for (const [key, value] of Object.entries(existing))
        result[key] = own(result, key) ? merge(result[key], value) : structuredClone(value);
    return result;
}
/**
 * Convert insert entries and top-level overrides without inventing insert rows.
 * DSH applyEntryPatches replaces config as a whole: repeated rows for the same id
 * therefore use the final config, not a deep merge of previous override records.
 * New module overrides require the matching module bundle to be installed.
 */
export function migratePatch(input) {
    validate(input);
    if (!Array.isArray(input))
        throw new TypeError('patch: expected a top-level array');
    const patches = structuredClone(input);
    const records = [];
    const visit = (rows, path, entries = false, inheritedDisabled = false) => {
        for (const [index, row] of rows.entries()) {
            const at = `${path}[${index}]`;
            if (!object(row))
                throw new TypeError(`${at}: expected an entry or patch object`);
            if (own(row, 'disabled') && typeof row.disabled !== 'boolean')
                throw new TypeError(`${at}.disabled: expected boolean`);
            if (own(row, 'insert')) {
                if (entries)
                    throw new TypeError(`${at}: insert patches inside entry lists are not supported by DSH`);
                if (!Array.isArray(row.insert))
                    throw new TypeError(`${at}.insert: expected an array`);
                visit(row.insert, `${at}.insert`, true, inheritedDisabled);
                continue;
            }
            if (typeof row.id !== 'string' || !row.id)
                throw new TypeError(`${at}.id: expected a nonempty string`);
            if (row.group) {
                if (!entries)
                    throw new TypeError(`${at}: group overrides cannot safely reconstruct entry-list replacement semantics`);
                if (!Array.isArray(row.config))
                    throw new TypeError(`${at}.config: expected a group entry array`);
                visit(row.config, `${at}.config`, true, inheritedDisabled || row.disabled === true);
            }
            else
                records.push({ row, at, inheritedDisabled });
        }
    };
    visit(patches, 'patch');
    const roots = new Map();
    const modules = new Map();
    for (const record of records) {
        const { row, at, inheritedDisabled } = record;
        const relevant = ROOT_IDS.includes(row.id) || Object.values(MODULE_NAMESPACES).some((name) => row.id === `dsh-toolkit-${name}`);
        if (!relevant)
            continue;
        if (own(row, 'config') && !object(row.config))
            throw new TypeError(`${at}.config: expected an object for ${row.id}`);
        if (inheritedDisabled)
            throw new TypeError(`${at}: toolkit entries under disabled groups require manual migration`);
        const map = ROOT_IDS.includes(row.id) ? roots : modules;
        const current = map.get(row.id) ?? {};
        if (own(row, 'config'))
            current.config = row.config;
        if (own(row, 'disabled'))
            current.disabled = row.disabled;
        map.set(row.id, current);
    }
    const defaults = new Map();
    // Separate historical root aliases may coexist. Conflicting values cannot be
    // ordered reliably without the complete profile, so refuse rather than guess.
    for (const [id, root] of roots) {
        for (const [namespace, name] of Object.entries(MODULE_NAMESPACES)) {
            const config = root.config?.[namespace];
            if (config !== undefined && !object(config))
                throw new TypeError(`${id}.config.${namespace}: expected an object`);
            const moduleId = `dsh-toolkit-${name}`;
            const next = { ...(config !== undefined ? { config } : {}), disabled: root.disabled ?? false };
            const previous = defaults.get(moduleId);
            if (previous && JSON.stringify(previous) !== JSON.stringify(next))
                throw new TypeError(`${moduleId}: conflicting legacy root aliases require manual migration`);
            defaults.set(moduleId, next);
        }
    }
    let changed = false;
    for (const { row } of records)
        if (ROOT_IDS.includes(row.id) && row.disabled !== true) {
            row.disabled = true;
            changed = true;
        }
    const migratedModules = [];
    for (const [id, legacy] of defaults) {
        const existing = modules.get(id) ?? {};
        const config = legacy.config === undefined ? existing.config : existing.config === undefined ? legacy.config : merge(legacy.config, existing.config);
        const disabled = existing.disabled ?? legacy.disabled;
        const update = { id };
        if (config !== undefined && JSON.stringify(config) !== JSON.stringify(existing.config))
            update.config = structuredClone(config);
        if (disabled !== undefined && disabled !== existing.disabled)
            update.disabled = disabled;
        if (Object.keys(update).length > 1) {
            patches.push(update);
            migratedModules.push(id);
            changed = true;
        }
    }
    return { patches, changed, migratedModules };
}
//# sourceMappingURL=migration.js.map