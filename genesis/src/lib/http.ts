// Wrapper minimo de fetch. D1 solo lo usa para GET JSON contra
// /api/*. Sin retries (los maneja TanStack Query), sin timeout
// personalizado (por ahora el default del navegador basta).
//
// El baseUrl es siempre relativo (`/api`): en produccion nginx hace
// reverse proxy; en dev el proxy de Vite hace lo mismo apuntando a
// http://localhost:3000. En ambos casos el navegador ve un solo
// origen, sin CORS.

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new HttpError(response.status, bodyText);
  }
  return (await response.json()) as T;
}
