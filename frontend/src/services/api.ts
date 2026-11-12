export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `The local server returned invalid JSON (${response.status}).`,
    );
  }
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}
export const write = <T = any>(
  path: string,
  body: unknown,
  method = "POST",
  options: Pick<RequestInit, "signal"> = {},
) => api<T>(path, { ...options, method, body: JSON.stringify(body) });
