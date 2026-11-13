import { deviceKindLabel, deviceOptionText } from "../presentation.js";
export function createDeviceOptions(React) {
  const h = React.createElement;
  function renderDeviceOptions(devices) {
    const groups = new Map();
    for (const device of devices) {
      const kind = deviceKindLabel(device.type);
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(device);
    }
    const entries = [...groups.entries()];
    if (entries.length <= 1) {
      return devices.map((d) => <option key={d.id} value={d.id}>
        {deviceOptionText(d, true)}
      </option>);
    }
    return entries.map(([kind, list]) => <optgroup key={kind} label={kind}>
      {list.map((d) => <option key={d.id} value={d.id}>
        {deviceOptionText(d, false)}
      </option>)}
    </optgroup>);
  }
  return renderDeviceOptions;
}
