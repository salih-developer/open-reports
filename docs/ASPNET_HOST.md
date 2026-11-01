# ASP.NET Core host and Visual Studio

`OpenReports.sln` opens the designer as an ASP.NET Core SPA in Visual Studio, in the same shape as the "React and ASP.NET Core" template. The reporting engine is still the Node server (`apps/server`): the host serves the designer and forwards the API to it, so the browser works against one origin.

The solution has one project, `apps/host/OpenReports.Host.csproj` (ASP.NET Core, .NET 10):

- The designer (`apps/designer`, a pnpm workspace package) shows under **ClientApp** in Solution Explorer. The files are linked for editing only: building the project never runs npm and never copies them.
- Development: SpaProxy starts the API and the designer's Vite server.
- Published: it serves the designer from `wwwroot` and forwards the API to the Node server with YARP.

## Requirements

- .NET 10 SDK, and for the IDE Visual Studio 2026 with the ASP.NET workload.
- Node 22 and pnpm, and the workspace built once: `pnpm install && pnpm build:all`.
- If your default `node` is not version 22, put a Node 22 executable in `.env` (it is gitignored):

  ```
  OPEN_REPORTS_NODE=C:\tools\node22\node.exe
  ```

## Develop

Open `OpenReports.sln`, set **OpenReports.Host** as the startup project and press F5, or run:

```bash
dotnet run --project apps/host --launch-profile http
```

The host listens on http://localhost:5300 (the `https` profile adds https://localhost:7300). SpaProxy runs `scripts/dev-spa-proxy.mjs`, which loads `.env` and starts `scripts/dev.mjs` with Node 22: the API on :4000 and the designer's Vite server on :3000 with hot reload. The browser is then redirected to the designer at http://127.0.0.1:3000. Stopping the host stops both.

SpaProxy and YARP use `127.0.0.1`, not `localhost`. Vite and the API listen on IPv4 only, and on Windows a refused `::1` connection takes about two seconds, longer than SpaProxy's readiness check waits. With `localhost` it keeps starting new dev servers.

Packages are still consumed from `dist/`: after changing anything in `packages/`, rebuild it (`pnpm --filter @reporting/<name> build`) and restart the host.

## Publish

```bash
pnpm build:all
dotnet publish apps/host -c Release -o out/host
```

Publishing runs the designer's `build` script (`npm run build`: tsc and Vite) and copies `apps/designer/dist` into `wwwroot`. The published host serves the designer, falls back to `index.html` for client routes, and forwards `/api`, `/health`, `/openapi.json`, `/embed` and `/mcp` to the Node API.

The Node API still has to run: `pnpm start`, or the Docker image (see [Deployment](DEPLOYMENT.md)), configured as in [Configuration](CONFIGURATION.md). Point the host at it in `appsettings.json`, or with an environment variable:

```
ReverseProxy__Clusters__reporting-api__Destinations__node__Address=http://reporting-api:4000/
```

Long renders are allowed up to 10 minutes per request (`HttpRequest.ActivityTimeout` on the cluster).
