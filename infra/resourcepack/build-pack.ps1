# Empaqueta el resource pack: genera pack.zip y muestra su SHA1.
# El SHA1 va en RESOURCE_PACK_SHA1 de infra/.env (Minecraft valida con el).
# NO usa Compress-Archive: en PowerShell 5.1 crea rutas internas con '\'
# y Minecraft solo entiende '/'. Se usa .NET directamente.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ogg = "assets\mcecosystem\sounds\evento\musica.ogg"
if (-not (Test-Path $ogg)) {
    Write-Error "Falta $ogg - coloca ahi la cancion (.ogg) antes de empaquetar."
}

Remove-Item pack.zip -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipPath = Join-Path $PSScriptRoot "pack.zip"
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
try {
    $files = @(Get-Item "pack.mcmeta") + (Get-ChildItem assets -Recurse -File)
    foreach ($f in $files) {
        # Ruta relativa con '/' SIEMPRE (requisito de Minecraft).
        $rel = $f.FullName.Substring($PSScriptRoot.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $f.FullName, $rel) | Out-Null
    }
} finally {
    $zip.Dispose()
}

$sha1 = (Get-FileHash pack.zip -Algorithm SHA1).Hash.ToLower()
"pack.zip generado ($([math]::Round((Get-Item pack.zip).Length/1MB,2)) MB)"
"SHA1: $sha1"
"-> Actualiza RESOURCE_PACK_SHA1 en infra/.env con ese valor."
