const AUTH_CHANNEL_NAME = "auth_logout_channel";

export function broadcastLogout() {
  if (typeof window === "undefined") return;
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    channel.postMessage({ type: "LOGOUT", timestamp: Date.now() });
    channel.close();
  }
  try {
    localStorage.setItem("auth_logout_event", Date.now().toString());
  } catch {}
}

export function subscribeToLogout(onLogout: () => void) {
  if (typeof window === "undefined") return () => {};

  const cleanups: Array<() => void> = [];
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "LOGOUT") {
        onLogout();
      }
    };
    channel.addEventListener("message", handleMessage);
    cleanups.push(() => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    });
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === "auth_logout_event") {
      onLogout();
    }
  };
  window.addEventListener("storage", handleStorage);
  cleanups.push(() => window.removeEventListener("storage", handleStorage));

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
}
