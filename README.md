# Bilibili para Kino

Plugin de **Bilibili** (versión China e Internacional) para [Kino](https://github.com/kinotvapp/kino-light).

- Buscar videos y anime
- Catálogo / home con secciones
- Capítulos de series (OGV internacional)
- Reproducción con firma WBI (China) y API intl
- Subtítulos cuando el servidor los ofrece
- Vincular cuenta (cookies SESSDATA) con navegador integrado
- Historial y favoritos con sesión
- `resolveAhead` + `prepare` (Kino 0.9.88+) para abrir más rápido

**Versión actual:** 1.6.0 · **apiVersion:** 23 · **Requiere:** Kino 0.9.83+ (mejor 0.9.88+)

## Instalar

1. En Kino: **Plugins → Agregar**
2. Escribe: `Susejing/kino-plugin-bilibili`
3. Acepta los hosts y activa el plugin

## Configurar

| Ajuste | Uso |
|--------|-----|
| **Versión** | `Internacional` (por defecto) o `China` |
| **Vincular cuenta** | Abre el login de Bilibili y guarda SESSDATA / DedeUserID / bili_jct |
| **Verificar cuenta** | Comprueba si la sesión sigue válida |
| **Sincronizar con Trakt** | Marca progreso si usas tracking |

### China vs Internacional

- **Internacional (`bilibili.tv`)**: suele funcionar sin VPN en más regiones.
- **China (`bilibili.com`)**: a menudo pide **VPN** o una **cuenta vinculada** (cookie). El error HTTP 412 casi siempre es bloqueo de región o sesión.

### Si no reproduce

1. Prueba **Internacional** primero.
2. Usa **Vincular cuenta** y **Verificar cuenta**.
3. En modo China, prueba con VPN.
4. Actualiza el plugin y reinicia Kino.

## Capacidades

`search` · `home` · `browse` · `episodes` · `resolve` · `subtitles` · `segments` · `tracking` · `playlists` · `download` · `scopedSearch`

## Licencia

GPL-3.0 · Autor: [Susejing](https://github.com/Susejing)
