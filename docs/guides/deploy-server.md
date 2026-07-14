# Forge WebUI Server Deployment

> **Unsupported configuration:** Forge WebUI is local-only and binds to the loopback interface.

Forge does not currently support LAN hosting, remote-server deployment, reverse proxies, tunnels, or public WebUI endpoints. Retired controls such as `--remote` and `AIONUI_ALLOW_REMOTE` are accepted for compatibility but are ignored.

For supported same-computer browser access, see [Forge WebUI - Local Browser Guide](webui.md).

Remote deployment requires a separate reviewed design covering authentication, session policy, TLS termination, origin policy, CSRF, rate limits, auditability, secret handling, and deployment ownership. Do not use the historical recipes from earlier AionUi releases as a Forge production configuration.
