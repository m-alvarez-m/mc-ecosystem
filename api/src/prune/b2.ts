// Cliente mínimo de Backblaze B2 (v3 API) para el archivado de events.
//
// Se usa fetch nativo (Node 24) y no se añade ninguna dependencia npm;
// el servicio `backup` ya prueba B2 desde su propia identidad (restic),
// pero este proceso corre dentro del contenedor api y necesita subir un
// blob puntual una vez al mes.
//
// La interfaz `B2Uploader` es lo único que consume el resto del módulo
// de prune. Los tests inyectan una implementación en memoria; en
// producción se usa `createB2Client()`.

export interface B2UploadResult {
  fileId: string;
  fileName: string;
}

export interface B2Uploader {
  /** Sube el buffer con el nombre indicado. */
  upload(fileName: string, data: Buffer, contentType: string): Promise<B2UploadResult>;
  /** Descarga el objeto completo por nombre. Se usa para recalcular el sha256 remoto. */
  download(fileName: string): Promise<Buffer>;
}

interface B2AuthResponse {
  apiInfo: {
    storageApi: {
      apiUrl: string;
      downloadUrl: string;
      bucketId?: string;
    };
  };
  authorizationToken: string;
}

interface B2UploadUrlResponse {
  uploadUrl: string;
  authorizationToken: string;
}

interface B2UploadFileResponse {
  fileId: string;
  fileName: string;
}

interface B2ListBucketsResponse {
  buckets: Array<{ bucketId: string; bucketName: string }>;
}

// SHA-1 hex de un Buffer. B2 exige X-Bz-Content-Sha1 (SHA-1, no SHA-256)
// como header nativo de integridad del upload. El SHA-256 propio del
// ADR-012 se calcula en paralelo por el orquestador.
async function sha1Hex(data: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(data).digest("hex");
}

export interface B2ClientOptions {
  accountId: string;
  accountKey: string;
  bucket: string;
  /** Fetch inyectable — los tests pasan una implementación fake. */
  fetchImpl?: typeof fetch;
}

// Cliente real. Cada `upload()` re-autentica: la operación corre una
// vez al mes, el ahorro de cachear el token no compensa la complejidad
// (los tokens B2 expiran, invalidan, y añadir refresh es innecesario a
// esta cadencia).
export function createB2Client(opts: B2ClientOptions): B2Uploader {
  const doFetch = opts.fetchImpl ?? fetch;

  async function authenticate(): Promise<B2AuthResponse> {
    const basic = Buffer.from(`${opts.accountId}:${opts.accountKey}`).toString("base64");
    const res = await doFetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) throw new Error(`b2_authorize_account: HTTP ${res.status}`);
    return (await res.json()) as B2AuthResponse;
  }

  async function resolveBucketId(auth: B2AuthResponse): Promise<string> {
    // Si la key de B2 está restringida a un solo bucket, `apiInfo.storageApi.bucketId`
    // viene poblado por la propia respuesta de auth (evita un round-trip).
    if (auth.apiInfo.storageApi.bucketId) return auth.apiInfo.storageApi.bucketId;
    const res = await doFetch(`${auth.apiInfo.storageApi.apiUrl}/b2api/v3/b2_list_buckets`, {
      method: "POST",
      headers: {
        Authorization: auth.authorizationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accountId: opts.accountId, bucketName: opts.bucket }),
    });
    if (!res.ok) throw new Error(`b2_list_buckets: HTTP ${res.status}`);
    const body = (await res.json()) as B2ListBucketsResponse;
    const match = body.buckets.find((b) => b.bucketName === opts.bucket);
    if (!match) throw new Error(`bucket '${opts.bucket}' no encontrado en la cuenta`);
    return match.bucketId;
  }

  return {
    async upload(fileName, data, contentType) {
      const auth = await authenticate();
      const bucketId = await resolveBucketId(auth);

      const urlRes = await doFetch(`${auth.apiInfo.storageApi.apiUrl}/b2api/v3/b2_get_upload_url`, {
        method: "POST",
        headers: {
          Authorization: auth.authorizationToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bucketId }),
      });
      if (!urlRes.ok) throw new Error(`b2_get_upload_url: HTTP ${urlRes.status}`);
      const uploadInfo = (await urlRes.json()) as B2UploadUrlResponse;

      const sha1 = await sha1Hex(data);
      const uploadRes = await doFetch(uploadInfo.uploadUrl, {
        method: "POST",
        headers: {
          Authorization: uploadInfo.authorizationToken,
          "X-Bz-File-Name": encodeURIComponent(fileName),
          "Content-Type": contentType,
          "X-Bz-Content-Sha1": sha1,
          "Content-Length": String(data.byteLength),
        },
        // fetch nativo (undici) acepta Buffer/Uint8Array en runtime, pero
        // el tipo BodyInit de lib.dom no lo lista. Cast puntual; el
        // contrato de runtime está probado por integración en B2.
        body: data as unknown as BodyInit,
      });
      if (!uploadRes.ok) throw new Error(`b2_upload_file: HTTP ${uploadRes.status}`);
      const uploaded = (await uploadRes.json()) as B2UploadFileResponse;
      return { fileId: uploaded.fileId, fileName: uploaded.fileName };
    },

    async download(fileName) {
      const auth = await authenticate();
      // b2_download_file_by_name: GET {downloadUrl}/file/{bucketName}/{fileName}
      const url = `${auth.apiInfo.storageApi.downloadUrl}/file/${opts.bucket}/${encodeURIComponent(fileName)}`;
      const res = await doFetch(url, {
        headers: { Authorization: auth.authorizationToken },
      });
      if (!res.ok) throw new Error(`b2_download_file_by_name: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
    },
  };
}
