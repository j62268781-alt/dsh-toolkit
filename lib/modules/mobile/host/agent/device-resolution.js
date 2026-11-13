export async function resolveDevice(client, deviceId, toolName, { signal } = {}) {
    signal?.throwIfAborted();
    if (typeof deviceId === "string") {
        if (deviceId.trim() === "") {
            throw new Error(`${toolName}: device id 不能为空。`);
        }
        return { id: deviceId, name: deviceId };
    }
    const devices = await client.listDevices(signal ? { signal } : undefined);
    signal?.throwIfAborted();
    const online = devices.filter((device) => device.state === "online");
    if (online.length === 0) {
        throw new Error(`${toolName}: 没有在线设备。启动一个模拟器/模拟机，或用 USB 连一台开了调试的手机。`);
    }
    if (online.length > 1) {
        throw new Error(`${toolName}: 有 ${online.length} 台在线设备，需要显式指定 device。`
            + `可选：${online.map((device) => `${device.name}(${device.id})`).join("、")}`);
    }
    return online[0];
}
//# sourceMappingURL=device-resolution.js.map