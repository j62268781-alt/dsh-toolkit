export function createHookHistory(limit) {
    const capacity = Math.max(0, Math.floor(limit));
    const records = [];
    let nextId = 0;
    return {
        push(record) {
            const entry = { ...record, id: ++nextId, at: record.at ?? Date.now() };
            if (capacity === 0)
                return entry;
            records.push(entry);
            if (records.length > capacity)
                records.splice(0, records.length - capacity);
            return entry;
        },
        list() {
            // 新的在前：面板从上往下读，最近一次应该在第一行。
            return [...records].reverse();
        },
        clear() {
            records.length = 0;
        },
    };
}
//# sourceMappingURL=history.js.map