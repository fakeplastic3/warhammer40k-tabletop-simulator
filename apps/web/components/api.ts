export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001";
export function token() {
  return typeof window === "undefined"
    ? ""
    : (localStorage.getItem("tabletop-session") ?? "");
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(API + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "Request failed");
  return data;
}
export async function ensureSession(name: string) {
  if (!token()) {
    const result = await api<{ token: string }>("/sessions", { name });
    localStorage.setItem("tabletop-session", result.token);
  }
}
