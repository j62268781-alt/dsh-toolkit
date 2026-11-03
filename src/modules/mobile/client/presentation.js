export function deviceKindLabel(type) {
  if (type === "real") return "真机";
  if (type === "simulator" || type === "emulator") return "模拟器";
  return typeof type === "string" && type !== "" ? type : "未知";
}
export function deviceKindSuffix(device) {
  const label = deviceKindLabel(device?.type);
  return label === "" ? "" : ` · ${label}`;
}
export function deviceOptionText(device, withKind = true) {
  const kind = withKind ? deviceKindSuffix(device) : "";
  const offline = device.state === "online" ? "" : "（离线）";
  return `${device.name}${kind}${offline}`;
}
export function hintText(state, detail, hasFrame = false) {
  switch (state) {
    case "idle":
      return "选一台设备开始";
    case "connecting":
      if (typeof detail === "string" && detail !== "") return detail;
      return hasFrame ? "正在重连…" : "正在连接设备…（首次可能要等 on-device agent 启动）";
    case "playing":
      return "";
    // 保留终态文案；自动恢复中的断流使用 connecting。
    case "ended":
      return "流已结束";
    case "error":
      return typeof detail === "string" ? detail : "画面出错了";
    default:
      return "";
  }
}
export function stageOverlay({ state, detail, hasFrame, deviceState }) {
  if (deviceState === "offline") {
    return { visible: true, text: "设备已断开，正在等待重新连接…", floating: false, dim: false };
  }
  if (state === "playing") return { visible: false, text: "", floating: false, dim: false };
  return {
    visible: true,
    text: hintText(state, detail, hasFrame),
    floating: hasFrame,
    dim: state === "error" && !hasFrame
  };
}
