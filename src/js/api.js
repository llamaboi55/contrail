// Thin wrapper over Tauri so the same page also runs in a normal browser for previews.
const T = globalThis.window?.__TAURI__;
export const native = Boolean(T);

export async function call(cmd, args = {}) {
  if (!native) return null;
  return T.core.invoke(cmd, args);
}
