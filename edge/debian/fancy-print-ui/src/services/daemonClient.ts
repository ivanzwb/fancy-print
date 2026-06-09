// daemonClient — gRPC-web 客户端（基于 protobuf-es + fetch）
//
// 使用 @bufbuild/protobuf 的 toBinary / fromBinary 直接调用
// edge-daemon gRPC-web 端点，无需 @connectrpc/connect 运行时。
//
// 对应 doc/3 §3 IPC 契约

import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import {
  GetDeviceInfoRequestSchema,
  GetPreviewRequestSchema,
  CreatePrintJobRequestSchema,
  ConfirmPrintRequestSchema,
  CancelPrintJobRequestSchema,
  StartRecordingRequestSchema,
  StopRecordingRequestSchema,
  PlayAudioRequestSchema,
  StopPlaybackRequestSchema,
  GetParentLockStatusRequestSchema,
  ValidatePinRequestSchema,
  SetPinRequestSchema,
  UnlockDeviceRequestSchema,
  GetSettingsRequestSchema,
  UpdateSettingRequestSchema,
  FactoryResetRequestSchema,
  ListWiFiNetworksRequestSchema,
} from "../gen/edge_ipc_pb.js";
import type {
  DeviceInfo,
  DeviceStatus,
  PreviewData,
  ParentLockStatus,
  Settings,
  PrintJob,
  PrintResult,
  RecordingResult,
  RecordingStatus,
  WiFiNetwork,
} from "../gen/edge_ipc_pb.js";
import {
  DeviceInfoSchema,
  DeviceStatusSchema,
  PreviewDataSchema,
  ParentLockStatusSchema,
  SettingsSchema,
  PrintJobSchema,
  PrintResultSchema,
  RecordingStatusSchema,
  RecordingResultSchema,
  ValidatePinResponseSchema,
  SetPinResponseSchema,
  UnlockDeviceResponseSchema,
  UpdateSettingResponseSchema,
  FactoryResetResponseSchema,
  CancelPrintJobResponseSchema,
  PlayAudioResponseSchema,
  StopPlaybackResponseSchema,
  ListWiFiNetworksResponseSchema,
} from "../gen/edge_ipc_pb.js";

const DEFAULT_BASE_URL = "http://localhost:9090";
const SERVICE_PATH = "/fancyprint.edge.v1.EdgeDaemonService";

// ============================================================
// DaemonClient 类型 — edge-daemon 的 gRPC 方法签名
// ============================================================

export interface DaemonClient {
  getDeviceInfo(): Promise<DeviceInfo>;
  getDeviceStatus(): Promise<DeviceStatus>;
  getParentLockStatus(): Promise<ParentLockStatus>;
  getPreview(jobId: string): Promise<PreviewData>;
  validatePin(req: { pin: string }): Promise<ValidatePinResp>;
  setPin(req: { newPin: string; oldPin: string }): Promise<SetPinResp>;
  unlockDevice(req: { pin: string }): Promise<{ unlocked: boolean }>;
  getSettings(): Promise<Settings>;
  updateSetting(req: { key: string; value: string }): Promise<{ success: boolean }>;
  factoryReset(): Promise<{ success: boolean }>;
  createPrintJob(req: { contentMode: number; previewImageUrl: string; copies: number }): Promise<PrintJob>;
  confirmPrint(req: { jobId: string; confirmed: boolean }): Promise<PrintResult>;
  cancelPrintJob(req: { jobId: string }): Promise<{ success: boolean }>;
  startRecording(): Promise<RecordingStatus>;
  stopRecording(): Promise<RecordingResult>;
  playAudio(req: { audioPath: string }): Promise<{ started: boolean }>;
  stopPlayback(): Promise<{ stopped: boolean }>;
  listWiFiNetworks(): Promise<WiFiNetwork[]>;
  errorCodeToMessage(code: number): string;
}

interface ValidatePinResp {
  valid: boolean;
  remainingAttempts: number;
}

interface SetPinResp {
  success: boolean;
  errorMessage: string;
}

// ============================================================
// 创建客户端
// ============================================================

export function createDaemonClient(baseUrl?: string): DaemonClient {
  const endpoint = (baseUrl ?? DEFAULT_BASE_URL) + SERVICE_PATH;

  return {
    async getDeviceInfo() {
      const req = create(GetDeviceInfoRequestSchema, {});
      const body = toBinary(GetDeviceInfoRequestSchema, req);
      const resp = await fetch(`${endpoint}/GetDeviceInfo`, {
        method: "POST",
        headers: { "Content-Type": "application/proto" },
        body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      return fromBinary(DeviceInfoSchema, new Uint8Array(await resp.arrayBuffer()));
    },

    async getDeviceStatus() {
      // WatchDeviceStatus 是服务端流 RPC，无法通过 fetch+gRPC-web 调用。
      // 用 GetDeviceInfo 推导部分状态用于 UI 显示。
      let batteryPercent = 0;
      let storageFreeMb = 0;
      let connection = 0; // DEVICE_CONNECTION_UNSPECIFIED
      try {
        const info = await this.getDeviceInfo();
        batteryPercent = info.batteryPercent;
        storageFreeMb = info.storageFreeMb;
        connection = 1; // DEVICE_CONNECTION_ONLINE
      } catch {
        connection = 2; // DEVICE_CONNECTION_OFFLINE
      }
      return create(DeviceStatusSchema, {
        connection,
        batteryPercent,
        storageFreeMb,
        printerState: "ready",
        queueDepth: 0,
        audioState: 0,
        parentLockActive: false,
        temperatureCelsius: 0n,
      });
    },

    async getPreview(jobId: string) {
      const body = toBinary(GetPreviewRequestSchema, create(GetPreviewRequestSchema, { jobId }));
      const resp = await fetch(`${endpoint}/GetPreview`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      return fromBinary(PreviewDataSchema, new Uint8Array(await resp.arrayBuffer()));
    },

    async getParentLockStatus() {
      const req = create(GetParentLockStatusRequestSchema, {});
      const body = toBinary(GetParentLockStatusRequestSchema, req);
      const resp = await fetch(`${endpoint}/GetParentLockStatus`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      return fromBinary(ParentLockStatusSchema, new Uint8Array(await resp.arrayBuffer()));
    },

    async validatePin(req: { pin: string }) {
      const body = toBinary(ValidatePinRequestSchema, create(ValidatePinRequestSchema, { pin: req.pin }));
      const resp = await fetch(`${endpoint}/ValidatePin`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      const data = fromBinary(ValidatePinResponseSchema, new Uint8Array(await resp.arrayBuffer()));
      return { valid: data.valid, remainingAttempts: data.remainingAttempts };
    },

    async setPin(req: { newPin: string; oldPin: string }) {
      const body = toBinary(SetPinRequestSchema, create(SetPinRequestSchema, req));
      const resp = await fetch(`${endpoint}/SetPin`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      const data = fromBinary(SetPinResponseSchema, new Uint8Array(await resp.arrayBuffer()));
      return { success: data.success, errorMessage: data.errorMessage };
    },

    async unlockDevice(req: { pin: string }) {
      const body = toBinary(UnlockDeviceRequestSchema, create(UnlockDeviceRequestSchema, req));
      const resp = await fetch(`${endpoint}/UnlockDevice`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      const data = fromBinary(UnlockDeviceResponseSchema, new Uint8Array(await resp.arrayBuffer()));
      return { unlocked: data.unlocked };
    },

    async getSettings() {
      const req = create(GetSettingsRequestSchema, {});
      const body = toBinary(GetSettingsRequestSchema, req);
      const resp = await fetch(`${endpoint}/GetSettings`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      return fromBinary(SettingsSchema, new Uint8Array(await resp.arrayBuffer()));
    },

    async updateSetting(req: { key: string; value: string }) {
      const body = toBinary(UpdateSettingRequestSchema, create(UpdateSettingRequestSchema, req));
      const resp = await fetch(`${endpoint}/UpdateSetting`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      const data = fromBinary(UpdateSettingResponseSchema, new Uint8Array(await resp.arrayBuffer()));
      return { success: data.success };
    },

    async factoryReset() {
      const req = create(FactoryResetRequestSchema, {});
      const body = toBinary(FactoryResetRequestSchema, req);
      const resp = await fetch(`${endpoint}/FactoryReset`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      const data = fromBinary(FactoryResetResponseSchema, new Uint8Array(await resp.arrayBuffer()));
      return { success: data.success };
    },

    async createPrintJob(req: { contentMode: number; previewImageUrl: string; copies: number }) {
      const body = toBinary(CreatePrintJobRequestSchema, create(CreatePrintJobRequestSchema, req));
      const resp = await fetch(`${endpoint}/CreatePrintJob`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      return fromBinary(PrintJobSchema, new Uint8Array(await resp.arrayBuffer()));
    },

    async confirmPrint(req: { jobId: string; confirmed: boolean }) {
      const body = toBinary(ConfirmPrintRequestSchema, create(ConfirmPrintRequestSchema, req));
      const resp = await fetch(`${endpoint}/ConfirmPrint`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      return fromBinary(PrintResultSchema, new Uint8Array(await resp.arrayBuffer()));
    },

    async cancelPrintJob(req: { jobId: string }) {
      const body = toBinary(CancelPrintJobRequestSchema, create(CancelPrintJobRequestSchema, req));
      const resp = await fetch(`${endpoint}/CancelPrintJob`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      const data = fromBinary(CancelPrintJobResponseSchema, new Uint8Array(await resp.arrayBuffer()));
      return { success: data.success };
    },

    async startRecording() {
      const req = create(StartRecordingRequestSchema, {});
      const body = toBinary(StartRecordingRequestSchema, req);
      const resp = await fetch(`${endpoint}/StartRecording`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      return fromBinary(RecordingStatusSchema, new Uint8Array(await resp.arrayBuffer()));
    },

    async stopRecording() {
      const req = create(StopRecordingRequestSchema, {});
      const body = toBinary(StopRecordingRequestSchema, req);
      const resp = await fetch(`${endpoint}/StopRecording`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      return fromBinary(RecordingResultSchema, new Uint8Array(await resp.arrayBuffer()));
    },

    async playAudio(req: { audioPath: string }) {
      const body = toBinary(PlayAudioRequestSchema, create(PlayAudioRequestSchema, req));
      const resp = await fetch(`${endpoint}/PlayAudio`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      const data = fromBinary(PlayAudioResponseSchema, new Uint8Array(await resp.arrayBuffer()));
      return { started: data.started };
    },

    async stopPlayback() {
      const req = create(StopPlaybackRequestSchema, {});
      const body = toBinary(StopPlaybackRequestSchema, req);
      const resp = await fetch(`${endpoint}/StopPlayback`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      const data = fromBinary(StopPlaybackResponseSchema, new Uint8Array(await resp.arrayBuffer()));
      return { stopped: data.stopped };
    },

    async listWiFiNetworks() {
      const req = create(ListWiFiNetworksRequestSchema, {});
      const body = toBinary(ListWiFiNetworksRequestSchema, req);
      const resp = await fetch(`${endpoint}/ListWiFiNetworks`, {
        method: "POST", headers: { "Content-Type": "application/proto" }, body,
      });
      if (!resp.ok) throw new Error(`gRPC error ${resp.status}`);
      const data = fromBinary(ListWiFiNetworksResponseSchema, new Uint8Array(await resp.arrayBuffer()));
      return data.networks;
    },

    errorCodeToMessage(code: number): string {
      switch (code) {
        case 0: return '';
        case 1: return '网络不太好，请检查连接';
        case 2: return '内容不太合适，换一个试试吧';
        case 3: return '纸卡住啦，请爸爸妈妈帮忙~';
        case 4: return '没有纸了，请加纸哦';
        case 5: return '打印机有点热，让它休息一下';
        case 6: return '打印机正在忙，稍等再试';
        case 7: return '出了点小问题，再试试吧';
        case 8: return '听不到声音，检查一下麦克风';
        case 9: return '操作超时了，重新来一次吧';
        case 10: return '已取消';
        default: return `出错了(${code})`;
      }
    },
  };
}

// ============================================================
// 便捷函数 — 封装 boilerplate
// ============================================================

/** 查询设备信息 */
export async function getDeviceInfo(client: DaemonClient): Promise<DeviceInfo> {
  return client.getDeviceInfo();
}

/** 获取家长锁状态 */
export async function getParentLockStatus(client: DaemonClient): Promise<ParentLockStatus> {
  return client.getParentLockStatus();
}

/** 验证 PIN */
export async function validatePin(client: DaemonClient, pin: string): Promise<{ valid: boolean; remainingAttempts: number }> {
  return client.validatePin({ pin });
}

/** 设置 PIN */
export async function setPin(client: DaemonClient, newPin: string, oldPin?: string): Promise<{ success: boolean; errorMessage: string }> {
  return client.setPin({ newPin, oldPin: oldPin ?? "" });
}

/** 解锁设备 */
export async function unlockDevice(client: DaemonClient, pin: string): Promise<boolean> {
  const resp = await client.unlockDevice({ pin });
  return resp.unlocked;
}

/** 获取设置 */
export async function getSettings(client: DaemonClient): Promise<Settings> {
  return client.getSettings();
}

/** 更新设置 */
export async function updateSetting(client: DaemonClient, key: string, value: string): Promise<boolean> {
  const resp = await client.updateSetting({ key, value });
  return resp.success;
}

/** 工厂重置 */
export async function factoryReset(client: DaemonClient): Promise<boolean> {
  const resp = await client.factoryReset();
  return resp.success;
}

/** 创建打印任务 */
export async function createPrintJob(
  client: DaemonClient,
  contentMode: number,
  previewImageUrl?: string,
  copies?: number,
): Promise<PrintJob> {
  return client.createPrintJob({
    contentMode,
    previewImageUrl: previewImageUrl ?? "",
    copies: copies ?? 1,
  });
}

/** 确认打印 */
export async function confirmPrint(client: DaemonClient, jobId: string, confirmed: boolean): Promise<PrintResult> {
  return client.confirmPrint({ jobId, confirmed });
}

/** 取消打印任务 */
export async function cancelPrintJob(client: DaemonClient, jobId: string): Promise<boolean> {
  const resp = await client.cancelPrintJob({ jobId });
  return resp.success;
}

/** 开始录音 */
export async function startRecording(client: DaemonClient): Promise<RecordingStatus> {
  return client.startRecording();
}

/** 停止录音 */
export async function stopRecording(client: DaemonClient): Promise<RecordingResult> {
  return client.stopRecording();
}

/** 播放音频 */
export async function playAudio(client: DaemonClient, audioPath: string): Promise<boolean> {
  const resp = await client.playAudio({ audioPath });
  return resp.started;
}

/** 停止播放 */
export async function stopPlayback(client: DaemonClient): Promise<boolean> {
  const resp = await client.stopPlayback();
  return resp.stopped;
}

/** 查询当前设备状态（Web 端通过 GetDeviceInfo 推导） */
export async function getDeviceStatus(client: DaemonClient): Promise<DeviceStatus> {
  return client.getDeviceStatus();
}

/** 获取预览数据 */
export async function getPreview(client: DaemonClient, jobId: string): Promise<PreviewData> {
  return client.getPreview(jobId);
}

/** 扫描 WiFi 网络 */
export async function listWiFiNetworks(client: DaemonClient): Promise<WiFiNetwork[]> {
  return client.listWiFiNetworks();
}
