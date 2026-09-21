#!/usr/bin/env bash


# ==========================================
# Grundeinstellungen
# ==========================================

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NODE_DIR="$SCRIPT_DIR/node"
NODE_BIN="$NODE_DIR/bin"
NODE_EXE="$NODE_BIN/node"
NPM_EXE="$NODE_BIN/npm"

NODE_MODULES="$SCRIPT_DIR/node_modules"
PLAYER_DIR="$SCRIPT_DIR/packages/player"
PLAYER_DIST="$PLAYER_DIR/dist"
PLAYER_LINK="$NODE_MODULES/@vr-viewer/player"

VITE_PID=""

# ==========================================
# Aufräumen bei Ctrl+C / Beenden
# ==========================================

cleanup() {
    if [[ -n "${VITE_PID:-}" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
        echo
        echo "Beende Vite..."
        kill "$VITE_PID" 2>/dev/null || true
        wait "$VITE_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT
trap 'echo; echo "Abgebrochen."; exit 130' INT TERM

# ==========================================
# Hilfsfunktionen
# ==========================================

error_exit() {
    echo
    echo "FEHLER: $1"
    echo
    exit 1
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# ==========================================
# Ausgabe
# ==========================================

echo "=============================="
echo "VRPlayer"
echo "=============================="
echo
echo "Arbeitsverzeichnis: $SCRIPT_DIR"
echo

# ==========================================
# 1. Portable Node.js prüfen
# ==========================================

echo "=============================="
echo "Portable Node.js"
echo "=============================="
echo

if [[ ! -x "$NODE_EXE" ]]; then
    echo "Portable Node.js wurde nicht gefunden."

    if [[ "${VR_OFFLINE:-0}" == "1" ]]; then
        error_exit "Offline-Modus aktiv, aber $NODE_EXE fehlt."
    fi

    if ! command_exists curl; then
        error_exit "curl ist nicht installiert."
    fi

    if ! command_exists tar; then
        error_exit "tar ist nicht installiert."
    fi

    echo "Ermittle neueste Node.js-Version..."

    NODE_VERSION="$(
        curl --fail --silent --show-error \
            https://nodejs.org/dist/index.json |
        grep -o '"version":"v[^"]*"' |
        head -n 1 |
        sed -E 's/.*"version":"v([^"]*)".*/\1/'
    )" || error_exit "Node.js-Version konnte nicht ermittelt werden."

    [[ -n "$NODE_VERSION" ]] ||
        error_exit "Node.js-Version ist leer."

    ARCH="$(uname -m)"

    case "$ARCH" in
        x86_64)
            NODE_ARCH="x64"
            ;;
        aarch64|arm64)
            NODE_ARCH="arm64"
            ;;
        armv7l|armhf)
            NODE_ARCH="armv7l"
            ;;
        *)
            error_exit "Nicht unterstützte Architektur: $ARCH"
            ;;
    esac

    OS="$(uname -s)"

    case "$OS" in
        Linux)
            NODE_OS="linux"
            ;;
        Darwin)
            NODE_OS="darwin"
            ;;
        *)
            error_exit "Nicht unterstütztes Betriebssystem: $OS"
            ;;
    esac

    NODE_FILE="node-v${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}.tar.xz"
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_FILE}"
    TEMP_FILE="${TMPDIR:-/tmp}/${NODE_FILE}"

    echo "Lade Node.js $NODE_VERSION herunter..."
    echo "URL: $NODE_URL"

    curl --fail --location --show-error \
        --output "$TEMP_FILE" \
        "$NODE_URL" ||
        error_exit "Node.js konnte nicht heruntergeladen werden."

    echo "Entpacke Node.js..."

    rm -rf "$NODE_DIR"
    mkdir -p "$NODE_DIR"

    tar -xJf "$TEMP_FILE" \
        --strip-components=1 \
        -C "$NODE_DIR" ||
        error_exit "Node.js-Archiv konnte nicht entpackt werden."

    rm -f "$TEMP_FILE"

    chmod +x "$NODE_EXE" "$NPM_EXE" 2>/dev/null || true

    echo "Node.js wurde installiert."
else
    echo "[OK] Portable Node.js gefunden."
fi

export PATH="$NODE_BIN:$PATH"

echo
echo "Node-Version:"
"$NODE_EXE" --version

echo "npm-Version:"
"$NPM_EXE" --version

# ==========================================
# 2. Abhängigkeiten prüfen
# ==========================================

echo
echo "=============================="
echo "Prüfe Dependencies"
echo "=============================="
echo

[[ -f "$SCRIPT_DIR/package.json" ]] ||
    error_exit "Root package.json wurde nicht gefunden."

# Ein veralteter echter Ordner blockiert den npm-Workspace-Symlink.
if [[ -d "$PLAYER_LINK" && ! -L "$PLAYER_LINK" ]]; then
    echo "[WARNUNG] Veralteter Ordner gefunden:"
    echo "          $PLAYER_LINK"
    echo "Entferne blockierenden Ordner..."
    rm -rf "$PLAYER_LINK"
fi

DEPENDENCIES_OK=false

if [[ -d "$NODE_MODULES" && -f "$PLAYER_LINK/package.json" ]]; then
    DEPENDENCIES_OK=true
    echo "[OK] node_modules und @vr-viewer/player gefunden."
fi

if [[ "$DEPENDENCIES_OK" != true ]]; then
    echo "[MISSING] Workspace-Abhängigkeiten fehlen."

    if [[ "${VR_OFFLINE:-0}" == "1" ]]; then
        error_exit "Offline-Modus aktiv, aber die Dependencies fehlen."
    fi

    echo "Installiere npm-Dependencies..."

    "$NPM_EXE" install ||
        error_exit "npm install fehlgeschlagen."

    [[ -f "$PLAYER_LINK/package.json" ]] ||
        error_exit "@vr-viewer/player wurde nach npm install nicht gefunden."
else
    echo "Keine Installation erforderlich."
fi

# ==========================================
# 3. Player bauen
# ==========================================

echo
echo "=============================="
echo "Baue Player"
echo "=============================="
echo

[[ -d "$PLAYER_DIR" ]] ||
    error_exit "Player-Verzeichnis fehlt: $PLAYER_DIR"

if [[ -d "$PLAYER_DIST" ]]; then
    echo "[OK] Player-Build bereits vorhanden."
else
    echo "Player-Build fehlt. Starte Build..."

    "$NPM_EXE" run build --workspace packages/player ||
        error_exit "Player-Build fehlgeschlagen."
fi

# ==========================================
# 4. Workspace-Auflösung testen
# ==========================================

echo
echo "Prüfe @vr-viewer/player..."

(
    cd "$SCRIPT_DIR"
    "$NODE_EXE" -e \
        "require.resolve('@vr-viewer/player/package.json')"
) || error_exit "@vr-viewer/player kann nicht aufgelöst werden."

echo "[OK] @vr-viewer/player ist auflösbar."

# ==========================================
# 5. Vite starten
# ==========================================

echo
echo "=============================="
echo "Starte Vite"
echo "=============================="
echo

"$NPM_EXE" run start &
VITE_PID=$!

sleep 3

if ! kill -0 "$VITE_PID" 2>/dev/null; then
    error_exit "Vite konnte nicht gestartet werden."
fi

# ==========================================
# 6. Browser öffnen
# ==========================================

URL="http://localhost:5173"

if command_exists xdg-open; then
    xdg-open "$URL" >/dev/null 2>&1 &
elif command_exists gio; then
    gio open "$URL" >/dev/null 2>&1 &
elif command_exists open; then
    open "$URL" >/dev/null 2>&1 &
else
    echo "Kein Browser-Öffner gefunden."
fi

echo
echo "=============================="
echo "VRPlayer gestartet"
echo "=============================="
echo
echo "$URL"
echo
echo "Drücke Ctrl+C, um den Server zu beenden."
echo

wait "$VITE_PID"

