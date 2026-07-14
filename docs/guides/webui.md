# Forge WebUI - Local Browser Guide

Forge WebUI opens the Forge interface in a browser on the same computer where Forge is running.

> Forge WebUI is local-only. It binds to the loopback interface and does not support LAN access, remote servers, reverse proxies, tunnels, or public deployment.

## Start from Forge Desktop

1. Open **Settings**.
2. Select **WebUI**.
3. Turn on **Enable WebUI**.
4. Open or copy the displayed `localhost` URL on this computer.

The default production port is `25808`. Development builds may use a different port; use the URL shown by Forge.

## Start Electron in WebUI Mode

```bash

# macOS

/Applications/Forge.app/Contents/MacOS/Forge --webui

# Windows

Forge.exe --webui

# Linux

forge --webui
```

Open the local URL printed by Forge in a browser on the same computer.

## Start the Standalone Web CLI

```bash
aionui-web start
```

Choose a local port when needed:

```bash
aionui-web start --port 8080
```

You can also set `AIONUI_PORT`. Port configuration does not change the local-only bind policy.

## Sign In

Use the WebUI username and password shown or configured in Forge. If necessary, reset the WebUI password with the supported password-reset command for your installation.

## Retired Remote Controls

The following controls are accepted only so older launch scripts continue to start:

- `--remote`
- `AIONUI_ALLOW_REMOTE`
- `AIONUI_REMOTE`
- `AIONUI_HOST=0.0.0.0`
- `allowRemote: true` in legacy configuration

They do not enable network access. Forge prints a warning and continues binding to `127.0.0.1`.

## Troubleshooting

### The URL does not open

- Confirm WebUI is running in Forge Settings or in the terminal output.
- Use the exact local URL and port shown by Forge.
- Confirm another process is not already using the selected port.
- Try `http://localhost:<port>` and `http://127.0.0.1:<port>` on the same computer.

### Another device cannot connect

This is expected. Forge WebUI does not currently support access from another device. Do not expose it through a firewall rule, reverse proxy, or tunnel.

### Remote deployment is required

Remote WebUI deployment is not a supported Forge configuration. It requires a separate security design covering authentication, sessions, TLS, origins, CSRF, rate limits, audit logs, secrets, and deployment ownership.
