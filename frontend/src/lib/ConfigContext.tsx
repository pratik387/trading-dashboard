"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type ConfigType = "fixed" | "relative" | "1year";

interface ConfigContextType {
  configType: ConfigType;
  setConfigType: (config: ConfigType) => void;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [configType, setConfigType] = useState<ConfigType>("fixed");

  return (
    <ConfigContext.Provider value={{ configType, setConfigType }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error("useConfig must be used within a ConfigProvider");
  }
  return context;
}
