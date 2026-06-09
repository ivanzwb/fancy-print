// DaemonContext — 注入 daemon gRPC 客户端到组件树

import React, { createContext, useContext, useMemo } from "react";
import { createDaemonClient, type DaemonClient } from "./daemonClient.js";

const DaemonContext = createContext<DaemonClient | null>(null);

interface Props {
  children: React.ReactNode;
  baseUrl?: string;
}

export const DaemonProvider: React.FC<Props> = ({ children, baseUrl }) => {
  const client = useMemo(() => createDaemonClient(baseUrl), [baseUrl]);
  return (
    <DaemonContext.Provider value={client}>{children}</DaemonContext.Provider>
  );
};

export function useDaemon(): DaemonClient {
  const client = useContext(DaemonContext);
  if (!client) {
    throw new Error("useDaemon() must be used within <DaemonProvider>");
  }
  return client;
}
